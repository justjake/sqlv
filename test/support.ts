import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunSqlAdapter, type BunSqlConfig } from "../src/lib/adapters/BunSqlAdapter"
import { TursoAdapter } from "../src/lib/adapters/TursoAdapter"
import { createSession } from "../src/lib/createLocalPersistence"
import { createNoopLogStore } from "../src/lib/createNoopLogStore"
import { AdapterRegistry, type Protocol } from "../src/lib/interface/Adapter"
import { QueryRunnerImpl } from "../src/lib/QueryRunnerImpl"
import {
  type AddConnectionInput,
  type QueryEditorState,
  type RunQueryInput,
  type SqlVisor,
  type SqlVisorState,
} from "../src/lib/SqlVisor"
import type { Connection } from "../src/lib/types/Connection"
import { EpochMillis, type QueryExecution } from "../src/lib/types/Log"
import { OrderString } from "../src/lib/types/Order"
import { pendingQueryState, type QueryState } from "../src/lib/types/QueryState"

export async function createTempDir(prefix = "sqlv-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export function createQueryState<TData, TError = Error>(
  patch: Partial<QueryState<TData, TError>> = {},
): QueryState<TData, TError> {
  return {
    data: undefined,
    dataUpdateCount: 0,
    dataUpdatedAt: 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: "pending",
    fetchStatus: "idle",
    ...patch,
  }
}

export function makeConnection<Config>(args: {
  protocol: Protocol
  config: Config
  id?: string
  name?: string
  createdAt?: number
  order?: string
}): Connection<Config> {
  return {
    id: args.id ?? "conn-1",
    type: "connection",
    name: args.name ?? "Test Connection",
    createdAt: EpochMillis(args.createdAt ?? 1),
    order: OrderString(args.order ?? ""),
    protocol: args.protocol,
    config: args.config,
  }
}

export function makeQueryExecution(
  args: {
    id?: string
    connectionId?: string
    sessionId?: string
    sql?: string
    rows?: object[]
    error?: string
    status?: QueryExecution["status"]
    createdAt?: number
    finishedAt?: number
  } = {},
): QueryExecution {
  const rows = args.rows ?? []
  const createdAt = EpochMillis(args.createdAt ?? 1)
  const status = args.status ?? (args.error ? "error" : "success")

  return {
    type: "queryExecution",
    id: args.id ?? "execution-1",
    connectionId: args.connectionId ?? "conn-1",
    sessionId: args.sessionId ?? "session-1",
    createdAt,
    finishedAt: status === "pending" ? undefined : EpochMillis(args.finishedAt ?? createdAt),
    sql: {
      source: args.sql ?? "select 1",
      args: [],
    },
    sensitive: false,
    status,
    error: args.error,
    rows,
    rowCount: rows.length,
  }
}

export function createSqlVisorState(patch: Partial<SqlVisorState> = {}): SqlVisorState {
  const queryEditor: QueryEditorState = {
    text: "",
    ...patch.queryEditor,
  }
  const emptyDetailView: SqlVisorState["detailView"] = {
    kind: "empty",
    title: "Results",
    message: "Run a query to inspect results.",
  }

  return {
    sessionId: patch.sessionId ?? "session-1",
    connections: patch.connections ?? pendingQueryState<Connection<any>[]>([]),
    selectedConnectionId: patch.selectedConnectionId,
    queryEditor,
    history: patch.history ?? [],
    detailView: patch.detailView ?? emptyDetailView,
    queryExecution: patch.queryExecution ?? pendingQueryState<QueryExecution>(),
    objectsByConnectionId: patch.objectsByConnectionId ?? {},
  }
}

type EngineMethodOverrides = {
  addConnection?: (input: AddConnectionInput) => Promise<Connection<any>>
  runQuery?: (input?: RunQueryInput) => Promise<QueryExecution>
  restoreHistoryEntry?: (entryId: string) => void
  restoreQueryExecution?: (entryId: string) => void
  selectConnection?: (connectionId: string | undefined) => void
  setQueryEditorState?: (patch: Partial<Pick<QueryEditorState, "text">>) => void
}

export function createEngineStub(
  initialState: Partial<SqlVisorState> = {},
  overrides: EngineMethodOverrides = {},
  options: {
    registry?: AdapterRegistry
  } = {},
) {
  const listeners = new Set<() => void>()
  let state = createSqlVisorState(initialState)
  const registry = options.registry ?? new AdapterRegistry([new BunSqlAdapter(), new TursoAdapter()])

  const calls: {
    addConnection: AddConnectionInput[]
    restoreHistoryEntry: string[]
    restoreQueryExecution: string[]
    runQuery: RunQueryInput[]
    selectConnection: Array<string | undefined>
    setQueryEditorState: Array<Partial<Pick<QueryEditorState, "text">>>
  } = {
    addConnection: [],
    restoreHistoryEntry: [],
    restoreQueryExecution: [],
    runQuery: [],
    selectConnection: [],
    setQueryEditorState: [],
  }

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const engine = {
    registry,
    getState() {
      return state
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async addConnection(input: AddConnectionInput) {
      calls.addConnection.push(input)
      if (overrides.addConnection) {
        return overrides.addConnection(input)
      }

      const connection = {
        config: input.config,
        createdAt: EpochMillis(calls.addConnection.length),
        id: input.id ?? `conn-${calls.addConnection.length}`,
        name: input.name,
        order: OrderString(input.order ?? ""),
        protocol: input.protocol,
        type: "connection",
      } satisfies Connection<any>

      state = {
        ...state,
        connections: createQueryState({
          data: [...(state.connections.data ?? []), connection],
          dataUpdateCount: state.connections.dataUpdateCount + 1,
          dataUpdatedAt: Date.now(),
          fetchStatus: "idle",
          status: "success",
        }),
        selectedConnectionId: connection.id,
      }
      notify()
      return connection
    },
    async runQuery(input: RunQueryInput = {}) {
      calls.runQuery.push(input)
      if (overrides.runQuery) {
        return overrides.runQuery(input)
      }

      const entry = makeQueryExecution({
        id: `history-${calls.runQuery.length}`,
        connectionId: input.connectionId ?? state.selectedConnectionId ?? "conn-1",
        sql: input.text ?? state.queryEditor.text,
        rows: [],
      })

      state = {
        ...state,
        history: [entry, ...state.history],
      }
      notify()
      return entry
    },
    restoreHistoryEntry(entryId: string) {
      calls.restoreHistoryEntry.push(entryId)
      if (overrides.restoreHistoryEntry) {
        overrides.restoreHistoryEntry(entryId)
      }
    },
    restoreQueryExecution(entryId: string) {
      calls.restoreQueryExecution.push(entryId)
      if (overrides.restoreQueryExecution) {
        overrides.restoreQueryExecution(entryId)
      }
    },
    selectConnection(connectionId: string | undefined) {
      calls.selectConnection.push(connectionId)
      if (overrides.selectConnection) {
        overrides.selectConnection(connectionId)
        return
      }

      state = {
        ...state,
        selectedConnectionId: connectionId,
      }
      notify()
    },
    setQueryEditorState(patch: Partial<Pick<QueryEditorState, "text">>) {
      calls.setQueryEditorState.push(patch)
      if (overrides.setQueryEditorState) {
        overrides.setQueryEditorState(patch)
        return
      }

      const nextText = patch.text ?? state.queryEditor.text
      state = {
        ...state,
        queryEditor: {
          text: nextText,
        },
      }
      notify()
    },
    __notify: notify,
    __setState(patch: Partial<SqlVisorState>) {
      state = {
        ...state,
        ...patch,
      }
      notify()
    },
  } satisfies Pick<
    SqlVisor,
    | "addConnection"
    | "getState"
    | "registry"
    | "restoreHistoryEntry"
    | "restoreQueryExecution"
    | "runQuery"
    | "selectConnection"
    | "setQueryEditorState"
    | "subscribe"
  > & {
    __notify: () => void
    __setState: (patch: Partial<SqlVisorState>) => void
  }

  return {
    calls,
    engine: engine as unknown as SqlVisor,
    getState: () => state,
    setState: engine.__setState,
  }
}

export async function createBunQueryRunner(config: Partial<BunSqlConfig> = {}) {
  const adapter = new BunSqlAdapter()
  const connection = makeConnection<BunSqlConfig>({
    protocol: "bunsqlite",
    config: {
      path: ":memory:",
      ...config,
    },
  })
  const executor = await adapter.connect(connection.config)
  const session = createSession("sqlv-test")
  const db = new QueryRunnerImpl(session, connection, executor, createNoopLogStore())

  return {
    adapter,
    connection,
    db,
    session,
  }
}
