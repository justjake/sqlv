import { QueryClient } from "@tanstack/query-core"
import { describe, expect, test } from "bun:test"
import { type LocalPersistence, createSession } from "../../src/lib/createLocalPersistence"
import { init } from "../../src/lib/init"
import { AdapterRegistry, type Adapter } from "../../src/lib/interface/Adapter"
import { SqlVisor } from "../../src/lib/SqlVisor"
import { type LogEntry } from "../../src/lib/types/Log"
import type { ObjectInfo } from "../../src/lib/types/objects"
import { rowDispatcher, type BaseRow } from "../../src/lib/types/RowStore"
import type { SQL } from "../../src/lib/types/SQL"
import { makeConnection } from "../support"

class FakeBunAdapter implements Adapter<{ path: string }, unknown, {}> {
  readonly protocol = "bunsqlite"
  features = {}
  connectCalls = 0
  fetchObjectsCalls = 0
  queryCalls: string[] = []
  rowsByQuery = new Map<string, object[]>()
  errorsByQuery = new Map<string, Error>()
  objects: ObjectInfo[] = []

  describeConfig(config: { path: string }): string {
    return config.path
  }

  async connect(_config: { path: string }) {
    this.connectCalls += 1

    return {
      execute: async <Row>(req: { abortSignal: AbortSignal | undefined; sql: SQL<Row> }): Promise<{ rows: Row[] }> => {
        req.abortSignal?.throwIfAborted()
        const source = req.sql.toSource()
        this.queryCalls.push(source)
        const error = this.errorsByQuery.get(source)
        if (error) {
          throw error
        }
        return {
          rows: (this.rowsByQuery.get(source) ?? []) as Row[],
        }
      },
    }
  }

  async fetchObjects(_db: unknown): Promise<ObjectInfo[]> {
    this.fetchObjectsCalls += 1
    return this.objects
  }

  renderSQL(sql: SQL<any>) {
    return {
      args: sql.getArgs(),
      source: sql.toSource(),
    }
  }
}

function createMemoryStore<Row extends BaseRow>(initialRows: Row[], sortRows: (rows: Row[]) => Row[] = (rows) => rows) {
  const rows = new Map(initialRows.map((row) => [`${row.id}:${row.type}`, row]))

  return rowDispatcher<Row>(async <T2 extends Row>(action: any) => {
    switch (action.type) {
      case "query":
        return sortRows(Array.from(rows.values())) as T2[]
      case "get":
        return rows.get(`${action.ref.id}:${action.ref.type}`) as T2 | undefined
      case "insert":
      case "upsert":
        rows.set(`${action.row.id}:${action.row.type}`, action.row)
        return action.row
      case "update": {
        const key = `${action.ref.id}:${action.ref.type}`
        const current = rows.get(key)
        if (!current) {
          return undefined
        }
        rows.set(key, {
          ...current,
          ...action.patch,
        } as Row)
        return undefined
      }
      case "delete":
        rows.delete(`${action.ref.id}:${action.ref.type}`)
        return undefined
    }
  })
}

function createPersistence(
  initialConnections = [makeConnection({ config: { path: ":memory:" }, protocol: "bunsqlite" })],
) {
  const session = createSession("sqlvisor")
  const persist: LocalPersistence["persist"] = {
    connections: createMemoryStore(initialConnections, (rows) => rows.toSorted((a, b) => b.createdAt - a.createdAt)),
    log: createMemoryStore<LogEntry>([]),
  }

  return {
    persist,
    session,
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

describe("SqlVisor", () => {
  test("creates an engine, registers built-in adapters, and loads stored connections", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const registry = new AdapterRegistry([fakeAdapter])
    const first = makeConnection({
      config: {
        path: "/tmp/first.db",
      },
      createdAt: 1,
      id: "conn-1",
      name: "First",
      protocol: "bunsqlite",
    })
    const second = makeConnection({
      config: {
        path: "/tmp/second.db",
      },
      createdAt: 2,
      id: "conn-2",
      name: "Second",
      protocol: "bunsqlite",
    })
    const persistence = createPersistence([first, second])

    const engine = await SqlVisor.create({
      persistence,
      queryClient: createQueryClient(),
      registry,
    })

    const state = engine.getState()

    expect(registry.get("bunsqlite")).toBe(fakeAdapter)
    expect(registry.has("turso")).toBe(true)
    expect(state.connections.data?.map((connection) => connection.id)).toEqual(["conn-2", "conn-1"])
    expect(state.selectedConnectionId).toBe("conn-2")
    expect(await persistence.persist.log.get({ id: persistence.session.id, type: "session" })).toEqual(
      persistence.session,
    )
  })

  test("updates state, notifies listeners, and loads connection objects", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.objects = [
      { name: "main", type: "database" },
      { database: "main", name: "public", type: "schema" },
      { database: "main", name: "users", schema: undefined, type: "table" },
      { database: "main", name: "active_users", schema: undefined, type: "view" },
      { database: "main", name: "latest_users", schema: undefined, type: "matview" },
      {
        on: { database: "main", name: "users", schema: undefined, type: "table" },
        type: "index",
      },
      {
        on: { database: "main", name: "users", schema: undefined, type: "table" },
        type: "trigger",
      },
    ]

    const engine = await SqlVisor.create({
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })
    let notifications = 0
    const unsubscribe = engine.subscribe(() => {
      notifications += 1
    })

    engine.setQueryEditorState({ text: "select 1" })
    engine.setDetailView({
      kind: "empty",
      message: "waiting",
      title: "Details",
    })

    const created = await engine.addConnection({
      config: {
        path: "/tmp/third.db",
      },
      name: "Third",
      protocol: "bunsqlite",
    })
    const objects = await engine.loadConnectionObjects(created.id)
    engine.selectConnection("conn-1")
    unsubscribe()

    expect(objects).toEqual(fakeAdapter.objects)
    expect(engine.getState().objectsByConnectionId[created.id]?.data).toEqual(fakeAdapter.objects)
    expect(engine.getState().selectedConnectionId).toBe("conn-1")
    expect(engine.getState().queryEditor).toEqual({
      text: "select 1",
    })
    expect(notifications).toBeGreaterThanOrEqual(4)
    expect(fakeAdapter.fetchObjectsCalls).toBeGreaterThanOrEqual(1)
  })

  test("runs queries successfully and restores history entries", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 1", [{ value: 1 }])

    const engine = await SqlVisor.create({
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const entry = await engine.runQuery({
      text: "select 1",
    })
    const second = await engine.runQuery({
      text: "select 1",
    })

    engine.restoreHistoryEntry(entry.id)

    expect(entry.rows).toEqual([{ value: 1 }])
    expect(second.rows).toEqual([{ value: 1 }])
    expect(fakeAdapter.connectCalls).toBe(1)
    expect(fakeAdapter.queryCalls).toEqual(["select 1", "select 1"])
    expect(engine.getState().history[0]?.sql.source).toBe("select 1")
    expect(engine.getState().detailView).toEqual({
      kind: "rows",
      rows: [{ value: 1 }],
      title: "Results (1)",
    })
    expect(engine.getState().queryExecution.data?.sql.source).toBe("select 1")
    expect(engine.getState().queryExecution.status).toBe("success")
    expect(engine.getState().queryEditor.text).toBe("select 1")
  })

  test("rejects invalid queries and records failed executions", async () => {
    const emptyEngine = await SqlVisor.create({
      persistence: createPersistence([]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    await expect(emptyEngine.runQuery({ text: "select 1" })).rejects.toThrow("No connection selected.")

    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.errorsByQuery.set("fail", new Error("query failed"))
    const engine = await SqlVisor.create({
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    await expect(engine.runQuery({ text: "   " })).rejects.toThrow("Cannot run an empty query.")
    await expect(engine.runQuery({ text: "fail" })).rejects.toThrow("query failed")

    const history = engine.getState().history[0]
    expect(history).toMatchObject({
      connectionId: "conn-1",
      error: "query failed",
      rows: [],
      sql: {
        args: [],
        source: "fail",
      },
      status: "error",
    })
    expect(engine.getState().detailView).toEqual({
      kind: "error",
      message: "query failed",
      title: "Query Error",
    })
    expect(engine.getState().queryExecution.status).toBe("error")
  })

  test("initializes through the public init helper", async () => {
    const engine = await init({
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    expect(engine).toBeInstanceOf(SqlVisor)
    expect(engine.getState().sessionId).toBeTruthy()
  })
})
