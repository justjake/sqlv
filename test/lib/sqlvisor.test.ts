import { QueryClient } from "@tanstack/query-core"
import { describe, expect, test } from "bun:test"
import { type LocalPersistence, createSession } from "../../src/lib/createLocalPersistence"
import { init } from "../../src/lib/init"
import { AdapterRegistry, type Adapter } from "../../src/lib/interface/Adapter"
import { SqlVisor, type OpenEditorSuggestionMenuInput, type QueryRef } from "../../src/lib/SqlVisor"
import type { SuggestionItem, SuggestionProvider, SuggestionRequest } from "../../src/lib/suggestions"
import type { ExplainResult } from "../../src/lib/types/Explain"
import { type LogEntry } from "../../src/lib/types/Log"
import type { ObjectInfo } from "../../src/lib/types/objects"
import { rowDispatcher, type BaseRow } from "../../src/lib/types/RowStore"
import type { SavedQuery } from "../../src/lib/types/SavedQuery"
import { unsafeRawSQL, type SQL } from "../../src/lib/types/SQL"
import { makeConnection, makeQueryExecution, makeSavedQuery } from "../support"

class FakeBunAdapter implements Adapter<{ path: string }, unknown, {}> {
  readonly protocol = "bunsqlite"
  readonly treeSitterGrammar = "sql"
  features = {}
  connectCalls = 0
  fetchObjectsCalls = 0
  explainCalls = 0
  queryCalls: string[] = []
  rowsByQuery = new Map<string, object[]>()
  errorsByQuery = new Map<string, Error>()
  blockedQueries = new Set<string>()
  blockedExplainQueries = new Set<string>()
  explainErrorsByQuery = new Map<string, Error>()
  explainResultsByQuery = new Map<string, ExplainResult>()
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

    return this.explainResultsByQuery.get(input.text) ?? {
      diagnostics: [],
      status: "ok",
    }
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
  initialLogEntries: LogEntry[] = [],
  initialSavedQueries: SavedQuery[] = [],
) {
  const session = createSession("sqlvisor")
  const persist: LocalPersistence["persist"] = {
    connections: createMemoryStore(initialConnections, (rows) => rows.toSorted((a, b) => b.createdAt - a.createdAt)),
    log: createMemoryStore<LogEntry>(initialLogEntries),
    savedQueries: createMemoryStore(initialSavedQueries, (rows) =>
      rows.toSorted((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))),
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

function createSuggestionMenuInput(
  patch: Partial<OpenEditorSuggestionMenuInput> = {},
): OpenEditorSuggestionMenuInput {
  return {
    cursorOffset: patch.cursorOffset ?? 17,
    documentText: patch.documentText ?? "select * from @us",
    replacementRange: patch.replacementRange ?? { end: 17, start: 14 },
    trigger:
      patch.trigger ??
      {
        context: { triggerText: "@" },
        kind: "mention",
        query: "us",
      },
    scope: patch.scope,
  }
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
    expect(state.editor.treeSitterGrammar).toBe("sql")
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

    engine.setEditorState({
      cursorOffset: "select 1".length,
      text: "select 1",
    })
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
    expect(engine.getState().editor).toEqual({
      analysis: {
        status: "idle",
      },
      cursorOffset: "select 1".length,
      suggestionMenu: {
        items: [],
        open: false,
        query: "",
        status: "closed",
      },
      suggestionScopeMode: "all-connections",
      text: "select 1",
      treeSitterGrammar: "sql",
    })
    expect(notifications).toBeGreaterThanOrEqual(4)
    expect(fakeAdapter.fetchObjectsCalls).toBeGreaterThanOrEqual(1)
  })

  test("requests editor analysis, records a system flow, and stores the latest result", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.explainResultsByQuery.set("select 1", {
      columns: [{ name: "value", type: "INTEGER" }],
      diagnostics: [],
      status: "ok",
    })
    const persistence = createPersistence()

    const engine = await SqlVisor.create({
      persistence,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.requestEditorAnalysis({ text: "select 1" })

    await waitFor(() => engine.getState().editor.analysis.status === "ready")

    expect(fakeAdapter.explainCalls).toBe(1)
    expect(engine.getState().editor.analysis).toEqual({
      connectionId: "conn-1",
      error: undefined,
      requestedText: "select 1",
      result: {
        columns: [{ name: "value", type: "INTEGER" }],
        diagnostics: [],
        status: "ok",
      },
      status: "ready",
    })

    const logEntries = await persistence.persist.log.query(() => unsafeRawSQL<LogEntry>("select"))
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
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.requestEditorAnalysis({ text: "select slow" })
    await waitFor(() => engine.getState().editor.analysis.status === "loading")

    engine.requestEditorAnalysis({ text: "select fast" })

    await waitFor(() => engine.getState().editor.analysis.status === "ready")

    expect(engine.getState().editor.analysis.requestedText).toBe("select fast")
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
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.requestEditorAnalysis({ text: "select" })

    await waitFor(() => fakeAdapter.explainCalls === 1 && engine.getState().editor.analysis.status === "ready")

    expect(engine.getState().editor.analysis).toEqual({
      connectionId: "conn-1",
      error: undefined,
      requestedText: "select",
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
    })
  })

  test("runs queries successfully and restores history entries", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 1", [{ value: 1 }])

    const engine = await SqlVisor.create({
      persistence: createPersistence(),
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
    expect(engine.getState().queryExecution.data?.id).toBe(first.queryId)
    expect(engine.getState().detailView).toEqual({
      kind: "rows",
      rows: [{ value: 1 }],
      title: "Results (1)",
    })
    expect(engine.getState().queryExecution.data?.sql.source).toBe("select 1")
    expect(engine.getState().queryExecution.status).toBe("success")
    expect(engine.getState().editor.text).toBe("select 1")
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
      persistence: createPersistence(undefined, [older, newer]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    expect(engine.getState().history.map((entry) => entry.id)).toEqual(["history-2", "history-1"])

    engine.restoreQueryExecution(older.id)

    expect(engine.getState().editor.text).toBe("select 1")
    expect(engine.getState().queryExecution.data?.id).toBe(older.id)
    expect(engine.getState().detailView).toEqual({
      kind: "rows",
      rows: [{ value: 1 }],
      title: "Results (1)",
    })
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
      persistence: createPersistence(undefined, [], [newerButStale, olderButUpdated]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    expect(engine.getState().savedQueries.map((entry) => entry.id)).toEqual(["saved-1", "saved-2"])
  })

  test("saves a new query, persists it, and tags subsequent executions", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.rowsByQuery.set("select 7", [{ value: 7 }])
    const persistence = createPersistence()

    const engine = await SqlVisor.create({
      persistence,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.setEditorState({
      cursorOffset: "select 7".length,
      text: "select 7",
    })

    const savedQuery = await engine.saveQueryAsNew({ name: "Lucky seven" })

    expect(savedQuery.protocol).toBe("bunsqlite")
    expect(engine.getState().editor.savedQueryId).toBe(savedQuery.id)
    expect(engine.getState().savedQueries[0]).toEqual(savedQuery)
    expect(await persistence.persist.savedQueries.get({ id: savedQuery.id, type: "savedQuery" })).toEqual(savedQuery)

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
    expect(await persistence.persist.log.get({ id: query.queryId, type: "queryExecution" })).toMatchObject({
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
    const persistence = createPersistence(undefined, [], [initialSavedQuery])

    const engine = await SqlVisor.create({
      persistence,
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.restoreSavedQuery(initialSavedQuery.id)
    engine.setEditorState({
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
    expect(await persistence.persist.savedQueries.get({ id: initialSavedQuery.id, type: "savedQuery" })).toEqual(updated)
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
      persistence: createPersistence(undefined, [older, newer], [savedQuery]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const restored = engine.restoreSavedQuery(savedQuery.id)

    expect(restored).toEqual({
      queryExecutionId: "exec-newer",
      savedQuery,
    })
    expect(engine.getState().editor).toMatchObject({
      cursorOffset: savedQuery.text.length,
      savedQueryId: savedQuery.id,
      text: savedQuery.text,
    })
    expect(engine.getState().queryExecution.data?.id).toBe("exec-newer")
    expect(engine.getState().detailView).toEqual({
      kind: "rows",
      rows: [{ id: 2 }],
      title: "Results (1)",
    })
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
      persistence: createPersistence(undefined, [historicalExecution], [fallbackSavedQuery, noResultSavedQuery]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const restoredByFallback = engine.restoreSavedQuery(fallbackSavedQuery.id)

    expect(restoredByFallback).toEqual({
      queryExecutionId: "exec-fallback",
      savedQuery: fallbackSavedQuery,
    })
    expect(engine.getState().queryExecution.data?.id).toBe("exec-fallback")
    expect(engine.getState().detailView).toEqual({
      kind: "rows",
      rows: [{ id: 3 }],
      title: "Results (1)",
    })

    const restoredWithoutExecution = engine.restoreSavedQuery(noResultSavedQuery.id)

    expect(restoredWithoutExecution).toEqual({
      queryExecutionId: undefined,
      savedQuery: noResultSavedQuery,
    })
    expect(engine.getState().editor).toMatchObject({
      cursorOffset: noResultSavedQuery.text.length,
      savedQueryId: noResultSavedQuery.id,
      text: noResultSavedQuery.text,
    })
    expect(engine.getState().queryExecution.status).toBe("pending")
    expect(engine.getState().detailView).toEqual({
      kind: "empty",
      message: "No query run selected",
      title: "Results",
    })
  })

  test("rejects invalid queries and records failed executions", async () => {
    const emptyEngine = await SqlVisor.create({
      persistence: createPersistence([]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    expect(() => emptyEngine.runQuery({ text: "select 1" })).toThrow("No connection selected.")

    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.errorsByQuery.set("fail", new Error("query failed"))
    const engine = await SqlVisor.create({
      persistence: createPersistence(),
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
    expect(engine.getState().detailView).toEqual({
      kind: "error",
      message: "query failed",
      title: "Query Error",
    })
    expect(engine.getState().queryExecution.status).toBe("error")
  })

  test("cancels queries by ref and cancels all running queries", async () => {
    const fakeAdapter = new FakeBunAdapter()
    fakeAdapter.blockedQueries.add("wait 1")
    fakeAdapter.blockedQueries.add("wait 2")

    const engine = await SqlVisor.create({
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    const first = engine.runQuery({ text: "wait 1" })
    const second = engine.runQuery({ text: "wait 2" })

    await waitFor(() => engine.getState().activeQueries.length === 2)
    expect(engine.getState().activeQueries.map((query) => query.queryId)).toEqual(
      expect.arrayContaining([first.queryId, second.queryId]),
    )

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

    await waitFor(() => engine.getState().activeQueries.length === 0)
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

        if (request.scope.kind === "selected-connection") {
          return [
            {
              connectionId: request.scope.connectionId,
              id: `selected:${request.scope.connectionId}`,
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
      persistence: createPersistence([firstConnection, secondConnection]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
      suggestionProviders: [provider],
    })

    engine.openEditorSuggestionMenu(
      createSuggestionMenuInput({
        cursorOffset: "select 1".length,
        documentText: "select 1",
        replacementRange: { end: "select 1".length, start: "select 1".length - 1 },
        trigger: {
          kind: "custom",
          query: "us",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "ready")

    expect(requests[0]?.scope).toEqual({ kind: "all-connections" })
    expect(engine.getState().editor.suggestionMenu.items.map((item) => item.id)).toEqual([
      "conn-2:users",
      "conn-1:users",
    ])

    const query = engine.runQuery({ text: "select 1" })
    expect(engine.getState().editor.suggestionMenu.open).toBe(true)
    await waitForQueryState(engine, query, (state) => state.status === "success")
    expect(engine.getState().editor.suggestionMenu.open).toBe(true)

    engine.closeEditorSuggestionMenu()
    engine.openEditorSuggestionMenu(createSuggestionMenuInput())
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "ready")

    engine.focusEditorSuggestionMenuItem({ id: "conn-1:users" })
    expect(engine.getState().editor.suggestionMenu.focusedItemId).toBe("conn-1:users")

    const applied = engine.applyEditorSuggestionMenuItem()
    expect(applied).toBe(true)
    expect(engine.getState().selectedConnectionId).toBe("conn-1")
    expect(engine.getState().editor.suggestionScopeMode).toBe("selected-connection")
    expect(engine.getState().editor.text).toBe("select * from users")
    expect(engine.getState().editor.cursorOffset).toBe(19)
    expect(engine.getState().editor.suggestionMenu).toEqual({
      items: [],
      open: false,
      query: "",
      status: "closed",
    })

    engine.openEditorSuggestionMenu(
      createSuggestionMenuInput({
        cursorOffset: 18,
        documentText: "select * from @ord",
        replacementRange: { end: 18, start: 14 },
        trigger: {
          context: { triggerText: "@" },
          kind: "mention",
          query: "ord",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "ready")

    expect(requests.at(-1)?.scope).toEqual({
      connectionId: "conn-1",
      kind: "selected-connection",
    })
    expect(engine.getState().editor.suggestionMenu.items).toEqual([
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
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
      suggestionProviders: [
        {
          id: "slow-provider",
          getSuggestions(request) {
            if (request.trigger.query === "slow") {
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

    engine.openEditorSuggestionMenu(
      createSuggestionMenuInput({
        trigger: {
          kind: "custom",
          query: "slow",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "loading")

    engine.openEditorSuggestionMenu(
      createSuggestionMenuInput({
        trigger: {
          kind: "custom",
          query: "fresh",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "ready")

    expect(firstRequestAborted).toBe(true)
    expect(engine.getState().editor.suggestionMenu.items).toEqual([
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

    expect(engine.getState().editor.suggestionMenu.items).toEqual([
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
      persistence: createPersistence([firstConnection, secondConnection]),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([fakeAdapter]),
    })

    engine.openEditorSuggestionMenu(
      createSuggestionMenuInput({
        trigger: {
          context: { triggerText: "@" },
          kind: "mention",
          query: "active",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "ready")

    expect(fakeAdapter.fetchObjectsCalls).toBeGreaterThanOrEqual(2)
    expect(engine.getState().editor.suggestionMenu.items).toEqual([
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

    engine.openEditorSuggestionMenu(
      createSuggestionMenuInput({
        scope: {
          connectionId: "conn-1",
          kind: "selected-connection",
        },
        trigger: {
          context: { triggerText: "@" },
          kind: "mention",
          query: "latest",
        },
      }),
    )
    await waitFor(() => engine.getState().editor.suggestionMenu.status === "ready")

    expect(engine.getState().editor.suggestionMenu.items).toEqual([
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
      persistence: createPersistence(),
      queryClient: createQueryClient(),
      registry: new AdapterRegistry([new FakeBunAdapter()]),
    })

    expect(engine).toBeInstanceOf(SqlVisor)
    expect(engine.getState().sessionId).toBeTruthy()
  })
})
