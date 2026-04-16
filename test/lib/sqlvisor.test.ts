import { QueryClient } from "@tanstack/query-core"
import { describe, expect, test } from "bun:test"
import { type LocalStorage, createSession } from "../../src/platforms/bun/storage/createLocalStorage"
import type { AppStateRow } from "../../src/model/AppState"
import { createEditorAnalysisSubject } from "../../src/model/editor/analysis"
import { createEditorBuffer } from "../../src/model/editor/buffer"
import { type EditorCompletionContext, type SuggestionItem } from "../../src/model/editor/completion"
import { init } from "../../src/api/init"
import { AdapterRegistry, type Adapter } from "../../src/spi/Adapter"
import { SqlVisor, type QueryRef } from "../../src/api/SqlVisor"
import type { SuggestionProvider, SuggestionRequest } from "../../src/spi/SuggestionProvider"
import type { ExplainResult } from "../../src/model/Explain"
import { type LogEntry } from "../../src/model/Log"
import type { ObjectInfo } from "../../src/model/objects"
import { rowDispatcher, type BaseRow } from "../../src/model/RowStore"
import type { SavedQuery } from "../../src/model/SavedQuery"
import { defaultSettingsState, type AnySettingsRow } from "../../src/model/Settings"
import { unsafeRawSQL, type SQL } from "../../src/model/SQL"
import { makeAppStateRow, makeConnection, makeQueryExecution, makeSavedQuery, makeSettingsRow } from "../support"

class FakeBunAdapter implements Adapter<{ path: string }, unknown, {}> {
  readonly protocol = "bunsqlite"
  readonly treeSitterGrammar = "sql"
  readonly sqlFormatterLanguage = "sqlite"
  features = {}
  connectCalls = 0
  fetchObjectsCalls = 0
  explainCalls = 0
  findConnectionsCalls = 0
  queryCalls: string[] = []
  rowsByQuery = new Map<string, object[]>()
  errorsByQuery = new Map<string, Error>()
  blockedQueries = new Set<string>()
  blockedExplainQueries = new Set<string>()
  explainErrorsByQuery = new Map<string, Error>()
  explainResultsByQuery = new Map<string, ExplainResult>()
  objects: ObjectInfo[] = []
  connectionSuggestions: Array<{ name: string; config: Partial<{ path: string }> }> = []

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
        if (this.blockedQueries.has(source)) {
          return await new Promise<{ rows: Row[] }>((_resolve, reject) => {
            const onAbort = () => {
              const abortError = new Error("stopped")
              abortError.name = "AbortError"
              reject(abortError)
            }

            if (req.abortSignal?.aborted) {
              onAbort()
              return
            }

            req.abortSignal?.addEventListener("abort", onAbort, { once: true })
          })
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

  async findConnections() {
    this.findConnectionsCalls += 1
    return this.connectionSuggestions
  }

  async explain(_db: unknown, input: { abortSignal: AbortSignal; text: string }): Promise<ExplainResult> {
    this.explainCalls += 1
    input.abortSignal.throwIfAborted()

    const error = this.explainErrorsByQuery.get(input.text)
    if (error) {
      throw error
    }

    if (this.blockedExplainQueries.has(input.text)) {
      return await new Promise<ExplainResult>((resolve, reject) => {
        const onAbort = () => {
          const abortError = new Error("stopped")
          abortError.name = "AbortError"
          reject(abortError)
        }

        if (input.abortSignal.aborted) {
          onAbort()
          return
        }

        input.abortSignal.addEventListener("abort", onAbort, { once: true })
        void resolve
      })
    }

    return (
      this.explainResultsByQuery.get(input.text) ?? {
        diagnostics: [],
        status: "ok",
      }
    )
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
      case "list":
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
  initialLogEntries: LogEntry[] = [],
  initialSavedQueries: SavedQuery[] = [],
  initialSettings: AnySettingsRow[] = [],
  initialAppState: AppStateRow[] = [],
) {
  const session = createSession("sqlvisor")
  const storage: LocalStorage["storage"] = {
    connections: createMemoryStore(initialConnections, (rows) => rows.toSorted((a, b) => b.createdAt - a.createdAt)),
    log: createMemoryStore<LogEntry>(initialLogEntries),
    savedQueries: createMemoryStore(initialSavedQueries, (rows) =>
      rows.toSorted((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    ),
    appState: createMemoryStore(initialAppState),
    settings: createMemoryStore(initialSettings),
  }

  return {
    storage,
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

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function waitForQueryState(
  engine: SqlVisor,
  query: QueryRef,
  predicate: (state: ReturnType<SqlVisor["getQueryState"]>) => boolean,
  timeoutMs = 1000,
) {
  await waitFor(() => predicate(engine.getQueryState(query)), timeoutMs)
  return engine.getQueryState(query)
}

function createCompletionContext(patch: Partial<EditorCompletionContext> = {}): EditorCompletionContext {
  return {
    kind: patch.kind ?? "mention",
    query: patch.query ?? "us",
    replaceRange: patch.replaceRange ?? { end: 17, start: 14 },
    scope: patch.scope ?? { kind: "all-connections" },
  }
}

describe("SqlVisor", () => {
  test("creates an engine and loads stored connections", async () => {
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
    const storage = createPersistence([first, second])

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry,
    })

    const state = engine.getState()

    expect(registry.get("bunsqlite")).toBe(fakeAdapter)
    expect(state.connections.data?.map((connection) => connection.id)).toEqual(["conn-2", "conn-1"])
    expect(state.selectedConnectionId).toBe("conn-2")
    expect(state.editor.treeSitterGrammar).toBe("sql")
    expect(await storage.storage.log.get({ id: storage.session.id, type: "session" })).toEqual(storage.session)
    expect(state.settings).toEqual({
      ...defaultSettingsState(),
      workspace: {
        lastSelectedConnectionId: "conn-2",
      },
    })
  })

  test("loads ephemeral connection suggestions, filters existing connections, and refreshes after add/delete", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.connectionSuggestions = [
      {
        name: "existing.db",
        config: { path: "/tmp/existing.db" },
      },
      {
        name: "fresh.db",
        config: { path: "/tmp/fresh.db" },
      },
    ]

    const storage = createPersistence([
      makeConnection({
        config: {
          path: "/tmp/existing.db",
        },
        id: "conn-existing",
        name: "Existing",
        protocol: "bunsqlite",
      }),
    ])

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    await engine.refreshConnectionSuggestions()

    expect(fakeAdapter.findConnectionsCalls).toBeGreaterThanOrEqual(1)
    expect(engine.getState().connectionSuggestions.data).toEqual([
      {
        config: { path: "/tmp/fresh.db" },
        id: expect.stringContaining("bunsqlite:fresh.db:"),
        name: "fresh.db",
        protocol: "bunsqlite",
      },
    ])

    await engine.addConnection({
      config: {
        path: "/tmp/fresh.db",
      },
      name: "Fresh",
      protocol: "bunsqlite",
    })
    await waitFor(() => (engine.getState().connectionSuggestions.data?.length ?? 0) === 0)

    const freshConnectionId = engine
      .getState()
      .connections.data?.find((connection) => connection.config.path === "/tmp/fresh.db")?.id
    expect(freshConnectionId).toBeDefined()

    await engine.deleteConnection(freshConnectionId!)
    await waitFor(() => (engine.getState().connectionSuggestions.data?.length ?? 0) === 1)

    expect(engine.getState().connectionSuggestions.data?.[0]).toEqual({
      config: { path: "/tmp/fresh.db" },
      id: expect.stringContaining("bunsqlite:fresh.db:"),
      name: "fresh.db",
      protocol: "bunsqlite",
    })
  })

  test("loads and updates persisted app state", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const registry = new AdapterRegistry([fakeAdapter])
    const storage = createPersistence(
      undefined,
      [],
      [],
      [],
      [makeAppStateRow("preferences", { iconStyle: "unicode" }, { createdAt: 10 })],
    )

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry,
    })

    expect(engine.getAppState("preferences")).toEqual({
      iconStyle: "unicode",
    })

    await engine.updateAppState("preferences", { iconStyle: "nerdfont" }, { iconStyle: "unicode" })

    expect(engine.getAppState("preferences")).toEqual({
      iconStyle: "nerdfont",
    })
    expect(await storage.storage.appState.get({ id: "preferences", type: "appState" })).toMatchObject({
      createdAt: 10,
      id: "preferences",
      type: "appState",
      updatedAt: expect.any(Number),
      value: {
        iconStyle: "nerdfont",
      },
    })
  })

  test("restores the selected connection from workspace settings and only loads that branch", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.objects = [{ name: "main", type: "database" }]
    const first = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-1",
      name: "First",
      protocol: "bunsqlite",
    })
    const second = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-2",
      name: "Second",
      protocol: "bunsqlite",
    })
    const storage = createPersistence(
      [first, second],
      [],
      [],
      [makeSettingsRow("workspace", { lastSelectedConnectionId: "conn-1" }, { createdAt: 10 })],
    )

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    await waitFor(() => engine.getState().objectsByConnectionId["conn-1"]?.data?.length === 1)

    expect(engine.getState().selectedConnectionId).toBe("conn-1")
    expect(engine.getState().settings).toEqual({
      ...defaultSettingsState(),
      workspace: {
        lastSelectedConnectionId: "conn-1",
      },
    })
    expect(engine.getState().objectsByConnectionId["conn-1"]?.data).toEqual(fakeAdapter.objects)
    expect(engine.getState().objectsByConnectionId["conn-2"]).toBeUndefined()
    expect(fakeAdapter.fetchObjectsCalls).toBe(1)
  })

  test("persists workspace selection when the selected connection changes", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.objects = [{ name: "main", type: "database" }]
    const first = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-1",
      name: "First",
      protocol: "bunsqlite",
    })
    const second = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-2",
      name: "Second",
      protocol: "bunsqlite",
    })
    const storage = createPersistence([first, second])

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.selectConnection(first.id)

    await waitFor(() => engine.getState().settings.workspace.lastSelectedConnectionId === first.id)

    expect(engine.getState().selectedConnectionId).toBe(first.id)
    expect(engine.getState().settings.workspace.lastSelectedConnectionId).toBe(first.id)
    expect(await storage.storage.settings.get({ id: "workspace", type: "settings" })).toMatchObject({
      id: "workspace",
      settings: {
        lastSelectedConnectionId: first.id,
      },
      type: "settings",
    })
  })

  test("deletes connections, clears loaded object state, and advances sidebar selection", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.objects = [{ name: "main", type: "database" }]
    const first = makeConnection({
      config: {
        path: ":memory:",
      },
      createdAt: 2,
      id: "conn-1",
      name: "First",
      protocol: "bunsqlite",
    })
    const second = makeConnection({
      config: {
        path: ":memory:",
      },
      createdAt: 1,
      id: "conn-2",
      name: "Second",
      protocol: "bunsqlite",
    })
    const storage = createPersistence([first, second])

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    await engine.loadConnectionObjects(first.id)
    expect(engine.getState().objectsByConnectionId[first.id]?.data).toEqual(fakeAdapter.objects)

    await engine.deleteConnection(first.id)
    await waitFor(() => engine.getState().selectedConnectionId === second.id)

    expect(engine.getState().connections.data?.map((connection) => connection.id)).toEqual([second.id])
    expect(engine.getState().selectedConnectionId).toBe(second.id)
    expect(engine.getState().settings.workspace.lastSelectedConnectionId).toBe(second.id)
    expect(engine.getState().objectsByConnectionId[first.id]).toBeUndefined()
    expect(await storage.storage.connections.get({ id: first.id, type: "connection" })).toBeUndefined()
    expect(await storage.storage.settings.get({ id: "workspace", type: "settings" })).toMatchObject({
      id: "workspace",
      settings: {
        lastSelectedConnectionId: second.id,
      },
      type: "settings",
    })
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
        name: "users_name_idx",
        on: { database: "main", name: "users", schema: undefined, type: "table" },
        type: "index",
      },
      {
        on: { database: "main", name: "users", schema: undefined, type: "table" },
        type: "trigger",
      },
    ]

    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })
    let notifications = 0
    const unsubscribe = engine.subscribe(() => {
      notifications += 1
    })

    engine.setEditorBuffer({
      cursorOffset: "select 1".length,
      text: "select 1",
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
    expect(engine.getState().editor).toEqual({
      analysis: {
        status: "idle",
      },
      buffer: {
        cursorOffset: "select 1".length,
        revision: 1,
        text: "select 1",
      },
      completion: {
        items: [],
        status: "closed",
      },
      completionScopeMode: "all-connections",
      treeSitterGrammar: "sql",
    })
    expect(notifications).toBeGreaterThanOrEqual(4)
    expect(fakeAdapter.fetchObjectsCalls).toBeGreaterThanOrEqual(1)
  })

  test("formats the editor query using the selected adapter dialect", async () => {
    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    engine.setEditorBuffer({
      cursorOffset: "select * from users where id = 1".length,
      text: "select * from users where id = 1",
    })
    engine.openEditorCompletion(
      createCompletionContext({
        kind: "identifier",
        query: "users",
        replaceRange: { end: "select * from users where id = 1".length, start: "select * from ".length },
        scope: {
          connectionId: "conn-1",
          kind: "selected-connection",
        },
      }),
    )

    expect(engine.formatEditorQuery()).toBe(true)
    expect(engine.getState().editor.buffer.text).toBe(`select
  *
from
  users
where
  id = 1`)
    expect(engine.getState().editor.buffer.cursorOffset).toBe("select * from users where id = 1".length)
    expect(engine.getState().editor.completion).toEqual({
      items: [],
      status: "closed",
    })
  })

  test("requests editor analysis, records a system flow, and stores the latest result", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.explainResultsByQuery.set("select 1", {
      columns: [{ name: "value", type: "INTEGER" }],
      diagnostics: [],
      status: "ok",
    })
    const storage = createPersistence()

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.setEditorBuffer({
      cursorOffset: "select 1".length,
      text: "select 1",
    })
    engine.requestEditorAnalysis()

    await waitFor(() => engine.getState().editor.analysis.status === "ready")

    expect(fakeAdapter.explainCalls).toBe(1)
    expect(engine.getState().editor.analysis).toEqual({
      error: undefined,
      result: {
        columns: [{ name: "value", type: "INTEGER" }],
        diagnostics: [],
        status: "ok",
      },
      status: "ready",
      subject: createEditorAnalysisSubject(createEditorBuffer("select 1", "select 1".length, 1), "conn-1"),
    })

    const logEntries = await storage.storage.log.query(() => unsafeRawSQL<LogEntry>("select"))
    expect(logEntries).toContainEqual(
      expect.objectContaining({
        connectionId: "conn-1",
        initiator: "system",
        name: "editor-explain",
        type: "flow",
      }),
    )
  })

  test("aborts superseded editor analysis requests", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.blockedExplainQueries.add("select slow")
    fakeAdapter.explainResultsByQuery.set("select fast", {
      diagnostics: [],
      status: "ok",
    })

    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.setEditorBuffer({
      cursorOffset: "select slow".length,
      text: "select slow",
    })
    engine.requestEditorAnalysis()
    await waitFor(() => engine.getState().editor.analysis.status === "loading")

    engine.setEditorBuffer({
      cursorOffset: "select fast".length,
      text: "select fast",
    })
    engine.requestEditorAnalysis()

    await waitFor(() => engine.getState().editor.analysis.status === "ready")

    expect(engine.getState().editor.analysis.subject?.text).toBe("select fast")
    expect(engine.getState().editor.analysis.result).toEqual({
      diagnostics: [],
      status: "ok",
    })
  })

  test("preserves incomplete-input editor analysis results for views to decide how to present", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.explainResultsByQuery.set("select", {
      diagnostics: [
        {
          code: "incomplete-input",
          message: "incomplete input",
          severity: "error",
        },
      ],
      status: "invalid",
    })

    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.setEditorBuffer({
      cursorOffset: "select".length,
      text: "select",
    })
    engine.requestEditorAnalysis()

    await waitFor(() => fakeAdapter.explainCalls === 1 && engine.getState().editor.analysis.status === "ready")

    expect(engine.getState().editor.analysis).toEqual({
      error: undefined,
      result: {
        diagnostics: [
          {
            code: "incomplete-input",
            message: "incomplete input",
            severity: "error",
          },
        ],
        status: "invalid",
      },
      status: "ready",
      subject: createEditorAnalysisSubject(createEditorBuffer("select", "select".length, 1), "conn-1"),
    })
  })

  test("runs queries successfully and restores history entries", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 1", [{ value: 1 }])

    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const first = engine.runQuery({
      text: "select 1",
    })
    const second = engine.runQuery({
      text: "select 1",
    })
    const firstState = await waitForQueryState(engine, first, (state) => state.status === "success")
    const secondState = await waitForQueryState(engine, second, (state) => state.status === "success")

    engine.restoreHistoryEntry(first.queryId)

    expect(firstState.data?.rows).toEqual([{ value: 1 }])
    expect(secondState.data?.rows).toEqual([{ value: 1 }])
    expect(fakeAdapter.connectCalls).toBe(1)
    expect(fakeAdapter.queryCalls).toEqual(["select 1", "select 1"])
    expect(engine.getState().history[0]?.sql.source).toBe("select 1")
    expect(engine.getState().selectedQueryExecutionId).toBe(first.queryId)
    expect(engine.getState().queryExecution.data?.id).toBe(first.queryId)
    expect(engine.getState().queryExecution.data?.rows).toEqual([{ value: 1 }])
    expect(engine.getState().queryExecution.data?.sql.source).toBe("select 1")
    expect(engine.getState().queryExecution.status).toBe("success")
    expect(engine.getState().editor.buffer.text).toBe("select 1")
  })

  test("loads persisted query history from previous sessions on create", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const older = makeQueryExecution({
      connectionId: "conn-1",
      createdAt: 10,
      finishedAt: 12,
      id: "history-1",
      rows: [{ value: 1 }],
      sessionId: "session-old-1",
      sql: "select 1",
    })
    const newer = makeQueryExecution({
      connectionId: "conn-1",
      createdAt: 20,
      error: "query failed",
      finishedAt: 22,
      id: "history-2",
      sessionId: "session-old-2",
      sql: "select 2",
    })

    const engine = await SqlVisor.create({
      storage: createPersistence(undefined, [older, newer]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    expect(engine.getState().history.map((entry) => entry.id)).toEqual(["history-2", "history-1"])

    engine.restoreQueryExecution(older.id)

    expect(engine.getState().editor.buffer.text).toBe("select 1")
    expect(engine.getState().selectedQueryExecutionId).toBe(older.id)
    expect(engine.getState().queryExecution.data?.id).toBe(older.id)
    expect(engine.getState().queryExecution.data?.rows).toEqual([{ value: 1 }])
  })

  test("restores a history entry from a deleted connection without selecting a stale connection", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 1", [{ value: 1 }])
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

    const engine = await SqlVisor.create({
      storage: createPersistence([first, second]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.selectConnection(first.id)
    const query = engine.runQuery({ text: "select 1" })
    await waitForQueryState(engine, query, (state) => state.status === "success")

    await engine.deleteConnection(first.id)
    await waitFor(() => engine.getState().selectedConnectionId === second.id)

    engine.restoreQueryExecution(query.queryId)

    expect(engine.getState().selectedConnectionId).toBeUndefined()
    expect(engine.getState().settings.workspace.lastSelectedConnectionId).toBe(second.id)
    expect(engine.getState().editor).toMatchObject({
      buffer: {
        cursorOffset: "select 1".length,
        text: "select 1",
      },
      treeSitterGrammar: undefined,
    })
    expect(engine.getState().selectedQueryExecutionId).toBe(query.queryId)
    expect(engine.getState().queryExecution.data?.connectionId).toBe(first.id)
    expect(engine.getState().queryExecution.data?.id).toBe(query.queryId)
    expect(engine.getState().queryExecution.data?.rows).toEqual([{ value: 1 }])
  })

  test("loads persisted saved queries from previous sessions on create", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const olderButUpdated = makeSavedQuery({
      createdAt: 10,
      id: "saved-1",
      name: "Updated Later",
      text: "select 1",
      updatedAt: 40,
    })
    const newerButStale = makeSavedQuery({
      createdAt: 20,
      id: "saved-2",
      name: "Created Later",
      text: "select 2",
    })

    const engine = await SqlVisor.create({
      storage: createPersistence(undefined, [], [newerButStale, olderButUpdated]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    expect(engine.getState().savedQueries.map((entry) => entry.id)).toEqual(["saved-1", "saved-2"])
  })

  test("saves a new query, persists it, and tags subsequent executions", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 7", [{ value: 7 }])
    const storage = createPersistence()

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.setEditorBuffer({
      cursorOffset: "select 7".length,
      text: "select 7",
    })

    const savedQuery = await engine.saveQueryAsNew({ name: "Lucky seven" })

    expect(savedQuery.protocol).toBe("bunsqlite")
    expect(engine.getState().editor.savedQueryId).toBe(savedQuery.id)
    expect(engine.getState().savedQueries[0]).toEqual(savedQuery)
    expect(await storage.storage.savedQueries.get({ id: savedQuery.id, type: "savedQuery" })).toEqual(savedQuery)

    const query = engine.runQuery()
    const queryState = await waitForQueryState(engine, query, (state) => state.status === "success")
    await waitFor(() => engine.getState().history[0]?.id === query.queryId)

    expect(queryState.data).toMatchObject({
      id: query.queryId,
      savedQueryId: savedQuery.id,
      sql: {
        source: "select 7",
      },
      status: "success",
    })
    expect(engine.getState().history[0]).toMatchObject({
      id: query.queryId,
      savedQueryId: savedQuery.id,
    })
    expect(await storage.storage.log.get({ id: query.queryId, type: "queryExecution" })).toMatchObject({
      id: query.queryId,
      savedQueryId: savedQuery.id,
      status: "success",
    })
  })

  test("saves changes back to the loaded saved query", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const initialSavedQuery = makeSavedQuery({
      createdAt: 10,
      id: "saved-1",
      name: "Audit",
      text: "select * from audit_log",
    })
    const storage = createPersistence(undefined, [], [initialSavedQuery])

    const engine = await SqlVisor.create({
      storage,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.restoreSavedQuery(initialSavedQuery.id)
    engine.setEditorBuffer({
      cursorOffset: "select * from audit_log where ok = 1".length,
      text: "select * from audit_log where ok = 1",
    })

    const updated = await engine.saveSavedQueryChanges({ name: "Audit OK Rows" })

    expect(updated).toMatchObject({
      id: initialSavedQuery.id,
      name: "Audit OK Rows",
      protocol: "bunsqlite",
      text: "select * from audit_log where ok = 1",
    })
    expect(updated.updatedAt).toBeDefined()
    expect(updated.updatedAt!).toBeGreaterThan(initialSavedQuery.createdAt)
    expect(engine.getState().editor.savedQueryId).toBe(initialSavedQuery.id)
    expect(engine.getState().savedQueries[0]).toEqual(updated)
    expect(await storage.storage.savedQueries.get({ id: initialSavedQuery.id, type: "savedQuery" })).toEqual(updated)
  })

  test("restores a saved query and loads its latest execution into the detail view", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const savedQuery = makeSavedQuery({
      createdAt: 10,
      id: "saved-audit",
      name: "Audit",
      text: "select * from audit_log",
    })
    const older = makeQueryExecution({
      connectionId: "conn-1",
      createdAt: 11,
      finishedAt: 12,
      id: "exec-older",
      rows: [{ id: 1 }],
      savedQueryId: savedQuery.id,
      sessionId: "session-old-1",
      sql: savedQuery.text,
    })
    const newer = makeQueryExecution({
      connectionId: "conn-1",
      createdAt: 21,
      finishedAt: 22,
      id: "exec-newer",
      rows: [{ id: 2 }],
      savedQueryId: savedQuery.id,
      sessionId: "session-old-2",
      sql: savedQuery.text,
    })

    const engine = await SqlVisor.create({
      storage: createPersistence(undefined, [older, newer], [savedQuery]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const restored = engine.restoreSavedQuery(savedQuery.id)

    expect(restored).toEqual({
      queryExecutionId: "exec-newer",
      savedQuery,
    })
    expect(engine.getState().editor).toMatchObject({
      buffer: {
        cursorOffset: savedQuery.text.length,
        text: savedQuery.text,
      },
      savedQueryId: savedQuery.id,
    })
    expect(engine.getState().selectedQueryExecutionId).toBe("exec-newer")
    expect(engine.getState().queryExecution.data?.id).toBe("exec-newer")
    expect(engine.getState().queryExecution.data?.rows).toEqual([{ id: 2 }])
  })

  test("restores a saved query onto an available connection when its latest execution connection was deleted", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const currentConnection = makeConnection({
      config: {
        path: "/tmp/current.db",
      },
      createdAt: 10,
      id: "conn-current",
      name: "Current",
      protocol: "bunsqlite",
    })
    const savedQuery = makeSavedQuery({
      createdAt: 20,
      id: "saved-audit",
      name: "Audit",
      protocol: "bunsqlite",
      text: "select * from audit_log",
    })
    const staleExecution = makeQueryExecution({
      connectionId: "conn-deleted",
      createdAt: 21,
      finishedAt: 22,
      id: "exec-deleted-connection",
      rows: [{ id: 7 }],
      savedQueryId: savedQuery.id,
      sessionId: "session-old",
      sql: savedQuery.text,
    })

    const engine = await SqlVisor.create({
      storage: createPersistence([currentConnection], [staleExecution], [savedQuery]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const restored = engine.restoreSavedQuery(savedQuery.id)

    expect(restored).toEqual({
      queryExecutionId: staleExecution.id,
      savedQuery,
    })
    expect(engine.getState().selectedConnectionId).toBe(currentConnection.id)
    expect(engine.getState().editor).toMatchObject({
      buffer: {
        cursorOffset: savedQuery.text.length,
        text: savedQuery.text,
      },
      savedQueryId: savedQuery.id,
      treeSitterGrammar: "sql",
    })
    expect(engine.getState().selectedQueryExecutionId).toBe(staleExecution.id)
    expect(engine.getState().queryExecution.data?.connectionId).toBe("conn-deleted")
    expect(engine.getState().queryExecution.data?.id).toBe(staleExecution.id)
    expect(engine.getState().queryExecution.data?.rows).toEqual([{ id: 7 }])
  })

  test("restores a saved query by matching previous executions on text and protocol, and clears detail when none exist", async () => {
    const fakeAdapter = new FakeBunAdapter()
    const fallbackSavedQuery = makeSavedQuery({
      createdAt: 10,
      id: "saved-fallback",
      name: "Fallback",
      protocol: "bunsqlite",
      text: "select * from fallback_log",
    })
    const noResultSavedQuery = makeSavedQuery({
      createdAt: 20,
      id: "saved-empty",
      name: "No Result",
      protocol: "bunsqlite",
      text: "select * from no_result_log",
    })
    const historicalExecution = makeQueryExecution({
      connectionId: "conn-1",
      createdAt: 30,
      finishedAt: 31,
      id: "exec-fallback",
      rows: [{ id: 3 }],
      sessionId: "session-old",
      sql: fallbackSavedQuery.text,
    })

    const engine = await SqlVisor.create({
      storage: createPersistence(undefined, [historicalExecution], [fallbackSavedQuery, noResultSavedQuery]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const restoredByFallback = engine.restoreSavedQuery(fallbackSavedQuery.id)

    expect(restoredByFallback).toEqual({
      queryExecutionId: "exec-fallback",
      savedQuery: fallbackSavedQuery,
    })
    expect(engine.getState().selectedQueryExecutionId).toBe("exec-fallback")
    expect(engine.getState().queryExecution.data?.id).toBe("exec-fallback")
    expect(engine.getState().queryExecution.data?.rows).toEqual([{ id: 3 }])

    const restoredWithoutExecution = engine.restoreSavedQuery(noResultSavedQuery.id)

    expect(restoredWithoutExecution).toEqual({
      queryExecutionId: undefined,
      savedQuery: noResultSavedQuery,
    })
    expect(engine.getState().editor).toMatchObject({
      buffer: {
        cursorOffset: noResultSavedQuery.text.length,
        text: noResultSavedQuery.text,
      },
      savedQueryId: noResultSavedQuery.id,
    })
    expect(engine.getState().selectedQueryExecutionId).toBeNull()
    expect(engine.getState().queryExecution.status).toBe("pending")
    expect(engine.getState().queryExecution.data).toBeUndefined()
  })

  test("rejects invalid queries and records failed executions", async () => {
    const emptyEngine = await SqlVisor.create({
      storage: createPersistence([]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    expect(() => emptyEngine.runQuery({ text: "select 1" })).toThrow("No connection selected.")

    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.errorsByQuery.set("fail", new Error("query failed"))
    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    expect(() => engine.runQuery({ text: "   " })).toThrow("Cannot run an empty query.")
    const failedQuery = engine.runQuery({ text: "fail" })
    const failedState = await waitForQueryState(engine, failedQuery, (state) => state.status === "error")

    const history = engine.getState().history[0]
    expect(failedState.data).toMatchObject({
      id: failedQuery.queryId,
      status: "error",
    })
    expect(history).toMatchObject({
      id: failedQuery.queryId,
      connectionId: "conn-1",
      error: "query failed",
      rows: [],
      sql: {
        args: [],
        source: "fail",
      },
      status: "error",
    })
    expect(engine.getState().selectedQueryExecutionId).toBe(failedQuery.queryId)
    expect(engine.getState().queryExecution.data?.error).toBe("query failed")
    expect(engine.getState().queryExecution.status).toBe("error")
  })

  test("cancels queries by ref and cancels all running queries", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.blockedQueries.add("wait 1")
    fakeAdapter.blockedQueries.add("wait 2")

    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const first = engine.runQuery({ text: "wait 1" })
    const second = engine.runQuery({ text: "wait 2" })

    await waitFor(() => engine.getState().history.filter((entry) => entry.status === "pending").length === 2)
    expect(
      engine
        .getState()
        .history.filter((entry) => entry.status === "pending")
        .map((entry) => entry.id),
    ).toEqual(expect.arrayContaining([first.queryId, second.queryId]))

    engine.cancelQuery(first)
    const firstState = await waitForQueryState(engine, first, (state) => state.status === "error")
    expect(firstState.data).toMatchObject({
      id: first.queryId,
      status: "cancelled",
    })

    engine.cancelRunningQueries()
    const secondState = await waitForQueryState(engine, second, (state) => state.status === "error")
    expect(secondState.data).toMatchObject({
      id: second.queryId,
      status: "cancelled",
    })

    await waitFor(() => engine.getState().history.every((entry) => entry.status !== "pending"))
  })

  test("opens and applies editor suggestion menu items, switches connections, and preserves the menu while queries run", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 1", [{ value: 1 }])
    const firstConnection = makeConnection({
      config: {
        path: "/tmp/first.db",
      },
      createdAt: 1,
      id: "conn-1",
      name: "First",
      protocol: "bunsqlite",
    })
    const secondConnection = makeConnection({
      config: {
        path: "/tmp/second.db",
      },
      createdAt: 2,
      id: "conn-2",
      name: "Second",
      protocol: "bunsqlite",
    })
    const requests: SuggestionRequest[] = []
    const provider: SuggestionProvider = {
      id: "test-provider",
      async getSuggestions(request) {
        requests.push(request)

        if (request.completion.scope.kind === "selected-connection") {
          return [
            {
              connectionId: request.completion.scope.connectionId,
              id: `selected:${request.completion.scope.connectionId}`,
              insertText: "orders",
              kind: "table",
              label: "orders",
            },
          ]
        }

        return [
          {
            connectionId: "conn-2",
            id: "conn-2:users",
            insertText: "users",
            kind: "table",
            label: "users",
          },
          {
            connectionId: "conn-1",
            id: "conn-1:users",
            insertText: "users",
            kind: "table",
            label: "users",
          },
        ]
      },
    }

    const engine = await SqlVisor.create({
      storage: createPersistence([firstConnection, secondConnection]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
      suggestionProviders: [provider],
    })

    engine.setEditorBuffer({
      cursorOffset: "select 1".length,
      text: "select 1",
    })
    engine.openEditorCompletion(
      createCompletionContext({
        kind: "custom",
        query: "us",
        replaceRange: { end: "select 1".length, start: "select 1".length - 1 },
      }),
    )
    await waitFor(() => engine.getState().editor.completion.status === "ready")

    expect(requests[0]?.completion.scope).toEqual({ kind: "all-connections" })
    expect(engine.getState().editor.completion.items.map((item) => item.id)).toEqual(["conn-2:users", "conn-1:users"])

    const query = engine.runQuery({ text: "select 1" })
    expect(engine.getState().editor.completion.status).toBe("ready")
    await waitForQueryState(engine, query, (state) => state.status === "success")
    expect(engine.getState().editor.completion.status).toBe("ready")

    engine.closeEditorCompletion()
    engine.setEditorBuffer({
      cursorOffset: 17,
      text: "select * from @us",
    })
    engine.openEditorCompletion(createCompletionContext())
    await waitFor(() => engine.getState().editor.completion.status === "ready")

    engine.focusEditorCompletionItem({ id: "conn-1:users" })
    expect(engine.getState().editor.completion.focusedItemId).toBe("conn-1:users")

    const applied = engine.applyEditorCompletionItem()
    expect(applied).toBe(true)
    expect(engine.getState().selectedConnectionId).toBe("conn-1")
    expect(engine.getState().editor.completionScopeMode).toBe("selected-connection")
    expect(engine.getState().editor.buffer.text).toBe("select * from users")
    expect(engine.getState().editor.buffer.cursorOffset).toBe(19)
    expect(engine.getState().editor.completion).toEqual({
      items: [],
      status: "closed",
    })

    engine.setEditorBuffer({
      cursorOffset: 18,
      text: "select * from @ord",
    })
    engine.openEditorCompletion(
      createCompletionContext({
        kind: "mention",
        query: "ord",
        replaceRange: { end: 18, start: 14 },
        scope: {
          connectionId: "conn-1",
          kind: "selected-connection",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.completion.status === "ready")

    expect(requests.at(-1)?.completion.scope).toEqual({
      connectionId: "conn-1",
      kind: "selected-connection",
    })
    expect(engine.getState().editor.completion.items).toEqual([
      {
        connectionId: "conn-1",
        id: "selected:conn-1",
        insertText: "orders",
        kind: "table",
        label: "orders",
      },
    ])
  })

  test("cancels superseded suggestion requests and ignores stale results", async () => {
    const engine = await SqlVisor.create({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
      suggestionProviders: [
        {
          id: "slow-provider",
          getSuggestions(request) {
            if (request.completion.query === "slow") {
              return new Promise<SuggestionItem[]>((resolve) => {
                resolveFirstRequest = resolve
                request.abortSignal.addEventListener(
                  "abort",
                  () => {
                    firstRequestAborted = true
                  },
                  { once: true },
                )
              })
            }

            return Promise.resolve([
              {
                id: "fresh",
                insertText: "fresh",
                label: "fresh",
              },
            ])
          },
        },
      ],
    })
    let firstRequestAborted = false
    let resolveFirstRequest!: (items: SuggestionItem[]) => void

    engine.openEditorCompletion(
      createCompletionContext({
        kind: "custom",
        query: "slow",
      }),
    )
    await waitFor(() => engine.getState().editor.completion.status === "loading")

    engine.openEditorCompletion(
      createCompletionContext({
        kind: "custom",
        query: "fresh",
      }),
    )
    await waitFor(() => engine.getState().editor.completion.status === "ready")

    expect(firstRequestAborted).toBe(true)
    expect(engine.getState().editor.completion.items).toEqual([
      {
        id: "fresh",
        insertText: "fresh",
        label: "fresh",
      },
    ])

    resolveFirstRequest([
      {
        id: "stale",
        insertText: "stale",
        label: "stale",
      },
    ])
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(engine.getState().editor.completion.items).toEqual([
      {
        id: "fresh",
        insertText: "fresh",
        label: "fresh",
      },
    ])
  })

  test("uses the built-in known objects suggestion provider across connections and selected scopes", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.objects = [
      { database: "main", name: "users", schema: undefined, type: "table" },
      { database: "main", name: "active_users", schema: undefined, type: "view" },
      { database: "main", name: "latest_users", schema: undefined, type: "matview" },
      {
        name: "users_name_idx",
        on: { database: "main", name: "users", schema: undefined, type: "table" },
        type: "index",
      },
    ]
    const firstConnection = makeConnection({
      config: {
        path: "/tmp/first.db",
      },
      createdAt: 1,
      id: "conn-1",
      name: "First",
      protocol: "bunsqlite",
    })
    const secondConnection = makeConnection({
      config: {
        path: "/tmp/second.db",
      },
      createdAt: 2,
      id: "conn-2",
      name: "Second",
      protocol: "bunsqlite",
    })

    const engine = await SqlVisor.create({
      storage: createPersistence([firstConnection, secondConnection]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.openEditorCompletion(
      createCompletionContext({
        kind: "mention",
        query: "active",
      }),
    )
    await waitFor(() => engine.getState().editor.completion.status === "ready")

    expect(fakeAdapter.fetchObjectsCalls).toBeGreaterThanOrEqual(2)
    expect(engine.getState().editor.completion.items).toEqual([
      {
        connectionId: "conn-1",
        detail: "First | view",
        id: "known-object:conn-1:view:main::active_users",
        insertText: "active_users",
        kind: "view",
        label: "active_users",
      },
      {
        connectionId: "conn-2",
        detail: "Second | view",
        id: "known-object:conn-2:view:main::active_users",
        insertText: "active_users",
        kind: "view",
        label: "active_users",
      },
    ])

    engine.openEditorCompletion(
      createCompletionContext({
        kind: "mention",
        query: "latest",
        scope: {
          connectionId: "conn-1",
          kind: "selected-connection",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.completion.status === "ready")

    expect(engine.getState().editor.completion.items).toEqual([
      {
        connectionId: "conn-1",
        detail: "First | matview",
        id: "known-object:conn-1:matview:main::latest_users",
        insertText: "latest_users",
        kind: "matview",
        label: "latest_users",
      },
    ])
  })

  test("initializes through the public init helper", async () => {
    const engine = await init({
      storage: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    expect(engine).toBeInstanceOf(SqlVisor)
    expect(engine.getState().sessionId).toBeTruthy()
  })
})
