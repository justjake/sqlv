import { QueryClient, type QueryKey } from "@tanstack/query-core"
import { BunSqlAdapter } from "./adapters/BunSqlAdapter"
import { sqlite } from "./adapters/sqlite"
import { TursoAdapter } from "./adapters/TursoAdapter"
import { createLocalPersistence, type LocalPersistence, type PersistenceStore } from "./createLocalPersistence"
import { AdapterRegistry, type AnyAdapter, type Protocol, type ProtocolConfig } from "./interface/Adapter"
import { QueryExecutionError, QueryRunnerImpl } from "./QueryRunnerImpl"
import { selectStoredRows } from "./sqliteRowStore"
import type { Connection } from "./types/Connection"
import { createId } from "./types/Id"
import { EpochMillis, type QueryExecution, type Session } from "./types/Log"
import type { ObjectInfo } from "./types/objects"
import { OrderString } from "./types/Order"
import { pendingQueryState, queryStateOrPending, type QueryState } from "./types/QueryState"
import { unsafeRawSQL } from "./types/SQL"

export type QueryEditorState = {
  text: string
}

export type DetailView =
  | {
      kind: "empty"
      title?: string
      message?: string
    }
  | {
      kind: "rows"
      title?: string
      rows: object[]
    }
  | {
      kind: "error"
      title?: string
      message: string
    }

export type ConnectionsState = QueryState<Connection<any>[]>
export type ConnectionObjectsState = QueryState<ObjectInfo[]>
export type QueryExecutionState = QueryState<QueryExecution>

export type SqlVisorState = {
  sessionId: string
  connections: ConnectionsState
  selectedConnectionId?: string
  queryEditor: QueryEditorState
  history: QueryExecution[]
  detailView: DetailView
  queryExecution: QueryExecutionState
  objectsByConnectionId: Record<string, ConnectionObjectsState>
}

export type AddConnectionInput<P extends Protocol = Protocol> = {
  id?: string
  name: string
  protocol: P
  config: ProtocolConfig<P>
  order?: string
}

export type RunQueryInput = {
  text?: string
  connectionId?: string
}

export type SqlVisorCreateOptions = {
  /** Unique name for this program. */
  app?: string
  adapters?: AnyAdapter[]
  registry?: AdapterRegistry
  persistence?: LocalPersistence
  queryClient?: QueryClient
}

type Listener = () => void

export class SqlVisor {
  static async create(options: SqlVisorCreateOptions = {}): Promise<SqlVisor> {
    const registry = options.registry ?? new AdapterRegistry()
    for (const adapter of options.adapters ?? builtInAdapters()) {
      if (!registry.has(adapter.protocol)) {
        registry.register(adapter)
      }
    }

    const persistence = options.persistence ?? (await createLocalPersistence({ registry }))
    await persistence.persist.log.upsert(persistence.session)

    const engine = new SqlVisor({
      registry,
      persist: persistence.persist,
      queryClient: options.queryClient ?? createQueryClient(),
      session: persistence.session,
    })

    await engine.refreshConnections()
    return engine
  }

  readonly registry: AdapterRegistry
  readonly persist: PersistenceStore
  readonly session: Session
  #queryClient: QueryClient
  #queryKeyPrefix: readonly ["sqlvisor", string]

  #listeners = new Set<Listener>()
  #queryRunners = new Map<string, QueryRunnerImpl<any>>()
  #activeQueryExecutionKey: QueryKey | undefined
  #state: SqlVisorState

  private constructor(args: {
    registry: AdapterRegistry
    persist: LocalPersistence["persist"]
    queryClient: QueryClient
    session: LocalPersistence["session"]
  }) {
    this.registry = args.registry
    this.persist = args.persist
    this.session = args.session
    this.#queryClient = args.queryClient
    this.#queryKeyPrefix = ["sqlvisor", args.session.id]
    this.#state = {
      sessionId: args.session.id,
      connections: pendingQueryState<Connection<any>[]>(),
      selectedConnectionId: undefined,
      queryEditor: {
        text: "",
      },
      history: [],
      detailView: {
        kind: "empty",
        title: "Results",
        message: "Run a query to inspect results.",
      },
      queryExecution: pendingQueryState<QueryExecution>(),
      objectsByConnectionId: {},
    }

    this.#queryClient.getQueryCache().subscribe(() => {
      this.#syncQueryState()
    })
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getState(): SqlVisorState {
    return this.#state
  }

  async refreshConnections(): Promise<Connection<any>[]> {
    const connections = await this.#queryClient.fetchQuery({
      gcTime: Infinity,
      queryKey: this.#connectionsQueryKey(),
      queryFn: async () =>
        this.persist.connections.query(
          (table) => sqlite<Connection<any>>`
            ${selectStoredRows<Connection<any>>(table)}
            ORDER BY createdAt DESC
          `,
        ),
      retry: false,
      staleTime: 0,
    })

    const selectedConnectionId = connections.some((connection) => connection.id === this.#state.selectedConnectionId)
      ? this.#state.selectedConnectionId
      : connections[0]?.id

    this.#setState({
      selectedConnectionId,
    })
    this.#syncQueryState()

    if (selectedConnectionId) {
      void this.loadConnectionObjects(selectedConnectionId)
    }

    return connections
  }

  async addConnection<P extends Protocol>(input: AddConnectionInput<P>): Promise<Connection<ProtocolConfig<P>>> {
    const connection: Connection<ProtocolConfig<P>> = {
      id: input.id ?? createId(),
      type: "connection",
      name: input.name,
      createdAt: EpochMillis.now(),
      order: OrderString(input.order ?? ""),
      protocol: input.protocol,
      config: input.config,
    }

    this.#queryRunners.delete(connection.id)
    await this.persist.connections.upsert(connection)
    await this.#queryClient.invalidateQueries({
      exact: true,
      queryKey: this.#connectionsQueryKey(),
    })
    await this.refreshConnections()
    this.selectConnection(connection.id)
    return connection
  }

  selectConnection(connectionId: string | undefined) {
    this.#setState({
      selectedConnectionId: connectionId,
    })
    this.#syncQueryState()

    if (connectionId) {
      void this.loadConnectionObjects(connectionId)
    }
  }

  setQueryEditorState(patch: Partial<Pick<QueryEditorState, "text">>) {
    this.#setState({
      queryEditor: {
        text: patch.text ?? this.#state.queryEditor.text,
      },
    })
  }

  setDetailView(detailView: DetailView) {
    this.#setState({ detailView })
  }

  restoreHistoryEntry(entryId: string) {
    this.restoreQueryExecution(entryId)
  }

  restoreQueryExecution(executionId: string) {
    const execution = this.#state.history.find((historyEntry) => historyEntry.id === executionId)
    if (!execution) {
      return
    }

    this.selectConnection(execution.connectionId)
    this.setQueryEditorState({ text: execution.sql.source })
    if (execution.status !== "success") {
      this.setDetailView({
        kind: "error",
        title: execution.status === "cancelled" ? "Query Cancelled" : "Query Error",
        message: execution.error ?? "Query failed.",
      })
      return
    }

    this.setDetailView({
      kind: "rows",
      title: `Results (${execution.rowCount})`,
      rows: execution.rows,
    })
  }

  async runQuery(input: RunQueryInput = {}): Promise<QueryExecution> {
    const text = input.text ?? this.#state.queryEditor.text
    const connectionId = input.connectionId ?? this.#state.selectedConnectionId

    if (input.text !== undefined) {
      this.setQueryEditorState({ text: input.text })
    }

    if (!text.trim()) {
      throw new Error("Cannot run an empty query.")
    }

    if (!connectionId) {
      throw new Error("No connection selected.")
    }

    const connection = this.#requireConnection(connectionId)
    const executionKey = this.#queryExecutionQueryKey(createId())
    this.#activeQueryExecutionKey = executionKey
    this.#syncQueryState()

    try {
      const execution = await this.#queryClient.fetchQuery({
        gcTime: 5 * 60 * 1000,
        queryKey: executionKey,
        queryFn: async () => {
          const db = await this.#getQueryRunner(connection)
          return db.execute(unsafeRawSQL<object>(text))
        },
        retry: false,
        staleTime: Infinity,
      })

      this.#setState({
        history: [execution, ...this.#state.history],
        detailView: {
          kind: "rows",
          title: `Results (${execution.rowCount})`,
          rows: execution.rows,
        },
      })

      return execution
    } catch (_error) {
      const error = _error instanceof Error ? _error : new Error(String(_error))
      const execution =
        error instanceof QueryExecutionError
          ? error.execution
          : createFailedQueryExecution({
              connectionId,
              sessionId: this.session.id,
              sql: text,
              error: error.message,
              errorStack: error.stack,
            })

      this.#setState({
        history: [execution, ...this.#state.history],
        detailView: {
          kind: "error",
          title: execution.status === "cancelled" ? "Query Cancelled" : "Query Error",
          message: execution.error ?? error.message,
        },
      })

      throw error
    }
  }

  async loadConnectionObjects(connectionId: string): Promise<ObjectInfo[]> {
    const connection = this.#requireConnection(connectionId)

    return this.#queryClient.fetchQuery({
      gcTime: 10 * 60 * 1000,
      queryKey: this.#connectionObjectsQueryKey(connectionId),
      queryFn: async () => {
        const db = await this.#getQueryRunner(connection)
        const adapter = this.registry.get(connection.protocol)
        return adapter.fetchObjects(db)
      },
      retry: false,
      staleTime: 0,
    })
  }

  async #getQueryRunner(connection: Connection<any>): Promise<QueryRunnerImpl<any>> {
    const existing = this.#queryRunners.get(connection.id)
    if (existing) {
      return existing
    }

    const adapter = this.registry.get(connection.protocol)
    const executor = await adapter.connect(connection.config)
    const queryRunner = new QueryRunnerImpl(this.session, connection, executor, this.persist.log)
    this.#queryRunners.set(connection.id, queryRunner)
    return queryRunner
  }

  #requireConnection(connectionId: string): Connection<any> {
    const connection = this.#state.connections.data?.find((candidate) => candidate.id === connectionId)
    if (!connection) {
      throw new Error(`Unknown connection: ${connectionId}`)
    }
    return connection
  }

  #syncQueryState() {
    const connections = queryStateOrPending(
      this.#queryClient.getQueryState<Connection<any>[]>(this.#connectionsQueryKey()),
    )
    const connectionIds = new Set<string>()
    for (const connection of connections.data ?? []) {
      connectionIds.add(connection.id)
    }
    if (this.#state.selectedConnectionId) {
      connectionIds.add(this.#state.selectedConnectionId)
    }
    for (const connectionId of Object.keys(this.#state.objectsByConnectionId)) {
      connectionIds.add(connectionId)
    }

    const objectsByConnectionId: Record<string, ConnectionObjectsState> = {}
    for (const connectionId of connectionIds) {
      objectsByConnectionId[connectionId] = queryStateOrPending(
        this.#queryClient.getQueryState<ObjectInfo[]>(this.#connectionObjectsQueryKey(connectionId)),
      )
    }

    const queryExecution = this.#activeQueryExecutionKey
      ? queryStateOrPending(this.#queryClient.getQueryState<QueryExecution>(this.#activeQueryExecutionKey))
      : pendingQueryState<QueryExecution>()

    this.#replaceState({
      connections,
      queryExecution,
      objectsByConnectionId,
    })
  }

  #setState(patch: Partial<SqlVisorState>) {
    this.#state = {
      ...this.#state,
      ...patch,
    }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #replaceState(patch: Pick<SqlVisorState, "connections" | "queryExecution" | "objectsByConnectionId">) {
    this.#state = {
      ...this.#state,
      ...patch,
    }
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #connectionsQueryKey(): readonly ["sqlvisor", string, "connections"] {
    return [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "connections"]
  }

  #connectionObjectsQueryKey(connectionId: string): readonly ["sqlvisor", string, "connections", string, "objects"] {
    return [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "connections", connectionId, "objects"]
  }

  #queryExecutionQueryKey(executionId: string): readonly ["sqlvisor", string, "query-execution", string] {
    return [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "query-execution", executionId]
  }
}

function builtInAdapters(): AnyAdapter[] {
  return [new TursoAdapter(), new BunSqlAdapter()]
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function createFailedQueryExecution(args: {
  connectionId: string
  sessionId: string
  sql: string
  error: string
  errorStack?: string
}): QueryExecution {
  const now = EpochMillis.now()
  return {
    type: "queryExecution",
    id: createId(),
    connectionId: args.connectionId,
    sessionId: args.sessionId,
    createdAt: now,
    finishedAt: now,
    sql: {
      source: args.sql,
      args: [],
    },
    sensitive: false,
    status: "error",
    error: args.error,
    errorStack: args.errorStack,
    rows: [],
    rowCount: 0,
  }
}
