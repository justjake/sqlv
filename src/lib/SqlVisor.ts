import { CancelledError, QueryClient } from "@tanstack/query-core"
import { BunSqlAdapter } from "./adapters/BunSqlAdapter"
import { sqlite } from "./adapters/sqlite"
import { TursoAdapter } from "./adapters/TursoAdapter"
import { createLocalPersistence, type LocalPersistence, type PersistenceStore } from "./createLocalPersistence"
import { formatQueryText } from "./formatQuery"
import { AdapterRegistry, type AnyAdapter, type Protocol, type ProtocolConfig } from "./interface/Adapter"
import { QueryExecutionError, QueryRunnerImpl } from "./QueryRunnerImpl"
import { KnownObjectsSuggestionProvider } from "./suggestions/KnownObjectsSuggestionProvider"
import type {
  EditorRange,
  EditorSuggestionMenuTrigger,
  EditorSuggestionScope,
  EditorSuggestionScopeMode,
  SuggestionItem,
  SuggestionProvider,
  SuggestionRequest,
} from "./suggestions/types"
import { selectStoredRows } from "./sqliteRowStore"
import type { Connection } from "./types/Connection"
import type { ExplainResult } from "./types/Explain"
import { createId } from "./types/Id"
import { EpochMillis, type LogEntry, type QueryExecution, type QueryFlow, type Session } from "./types/Log"
import type { ObjectInfo } from "./types/objects"
import { OrderString } from "./types/Order"
import { pendingQueryState, queryStateOrPending, type QueryState } from "./types/QueryState"
import type { SavedQuery } from "./types/SavedQuery"
import { unsafeRawSQL } from "./types/SQL"

export type EditorSuggestionMenuItemRef = {
  id: string
}

export type EditorSuggestionMenuItemFocusInput =
  | EditorSuggestionMenuItemRef
  | {
      delta: number
    }
  | {
      index: number
    }

export type EditorSuggestionMenuStatus = "closed" | "loading" | "ready" | "error"
export type EditorAnalysisStatus = "idle" | "loading" | "ready" | "error"

export type EditorSuggestionMenuState = {
  open: boolean
  status: EditorSuggestionMenuStatus
  trigger?: EditorSuggestionMenuTrigger
  query: string
  replacementRange?: EditorRange
  scope?: EditorSuggestionScope
  items: SuggestionItem[]
  focusedItemId?: string
  error?: string
}

export type EditorAnalysisState = {
  status: EditorAnalysisStatus
  requestedText?: string
  connectionId?: string
  result?: ExplainResult
  error?: string
}

export type EditorState = {
  text: string
  cursorOffset: number
  savedQueryId?: string
  treeSitterGrammar?: string
  suggestionScopeMode: EditorSuggestionScopeMode
  suggestionMenu: EditorSuggestionMenuState
  analysis: EditorAnalysisState
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

export type QueryRef = {
  queryId: string
}

export type ActiveQuery = {
  queryId: string
  text: string
  connectionId: string
  startedAt: number
}

export type SqlVisorState = {
  sessionId: string
  connections: ConnectionsState
  selectedConnectionId?: string
  editor: EditorState
  history: QueryExecution[]
  savedQueries: SavedQuery[]
  detailView: DetailView
  queryExecution: QueryExecutionState
  activeQueries: ActiveQuery[]
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

export type RequestEditorAnalysisInput = {
  text?: string
  connectionId?: string
  parentFlowId?: string
}

export type SaveQueryAsNewInput = {
  name: string
  text?: string
  protocol?: Protocol
}

export type SaveSavedQueryChangesInput = {
  name?: string
  text?: string
  protocol?: Protocol
}

export type RestoreSavedQueryResult = {
  savedQuery: SavedQuery
  queryExecutionId?: string
}

export type OpenEditorSuggestionMenuInput = {
  documentText: string
  cursorOffset: number
  replacementRange: EditorRange
  trigger: EditorSuggestionMenuTrigger
  scope?: EditorSuggestionScope
}

export type SqlVisorCreateOptions = {
  /** Unique name for this program. */
  app?: string
  adapters?: AnyAdapter[]
  registry?: AdapterRegistry
  persistence?: LocalPersistence
  queryClient?: QueryClient
  suggestionProviders?: SuggestionProvider[]
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
      suggestionProviders: options.suggestionProviders ?? builtInSuggestionProviders(),
    })

    await engine.refreshConnections()
    await engine.#loadPersistedHistory()
    await engine.#loadPersistedSavedQueries()
    return engine
  }

  readonly registry: AdapterRegistry
  readonly persist: PersistenceStore
  readonly session: Session
  #queryClient: QueryClient
  #queryKeyPrefix: readonly ["sqlvisor", string]
  #suggestionProviders: SuggestionProvider[]

  #listeners = new Set<Listener>()
  #queryRunners = new Map<string, QueryRunnerImpl<any>>()
  #currentQueryId: string | undefined
  #suggestionAbortController: AbortController | undefined
  #suggestionRequestSerial = 0
  #editorAnalysisAbortController: AbortController | undefined
  #editorAnalysisRequestSerial = 0
  #state: SqlVisorState

  private constructor(args: {
    registry: AdapterRegistry
    persist: LocalPersistence["persist"]
    queryClient: QueryClient
    session: LocalPersistence["session"]
    suggestionProviders: SuggestionProvider[]
  }) {
    this.registry = args.registry
    this.persist = args.persist
    this.session = args.session
    this.#queryClient = args.queryClient
    this.#queryKeyPrefix = ["sqlvisor", args.session.id]
    this.#suggestionProviders = args.suggestionProviders
    this.#state = this.#normalizeState({
      sessionId: args.session.id,
      connections: pendingQueryState<Connection<any>[]>(),
      selectedConnectionId: undefined,
      editor: {
        analysis: idleEditorAnalysisState(),
        text: "",
        cursorOffset: 0,
        savedQueryId: undefined,
        suggestionScopeMode: "all-connections",
        suggestionMenu: closedEditorSuggestionMenuState(),
      },
      history: [],
      savedQueries: [],
      detailView: {
        kind: "empty",
        title: "Results",
        message: "Run a query to inspect results.",
      },
      queryExecution: pendingQueryState<QueryExecution>(),
      activeQueries: [],
      objectsByConnectionId: {},
    })

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

  async #loadPersistedHistory(): Promise<void> {
    const logEntries = await this.persist.log.query(
      (table) => sqlite<LogEntry>`
        ${selectStoredRows<LogEntry>(table)}
        ORDER BY COALESCE(updatedAt, createdAt) DESC
      `,
    )
    const history = logEntries.filter(isQueryExecution).sort((a, b) => historySortTime(b) - historySortTime(a))
    this.#setState({ history })
  }

  async #loadPersistedSavedQueries(): Promise<void> {
    const savedQueries = await this.persist.savedQueries.query(
      (table) => sqlite<SavedQuery>`
        ${selectStoredRows<SavedQuery>(table)}
        ORDER BY COALESCE(updatedAt, createdAt) DESC
      `,
    )
    this.#setState({ savedQueries: sortSavedQueries(savedQueries) })
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
    if (connectionId !== this.#state.selectedConnectionId) {
      this.#abortEditorAnalysisRequest()
    }
    this.#setState({
      editor:
        connectionId === this.#state.selectedConnectionId
          ? this.#state.editor
          : {
              ...this.#state.editor,
              analysis: idleEditorAnalysisState(),
            },
      selectedConnectionId: connectionId,
    })
    this.#syncQueryState()

    if (connectionId) {
      void this.loadConnectionObjects(connectionId)
    }
  }

  setEditorState(patch: Partial<Pick<EditorState, "text" | "cursorOffset">> & {
    savedQueryId?: string | null
  }) {
    this.#setState({
      editor: {
        ...this.#state.editor,
        text: patch.text ?? this.#state.editor.text,
        cursorOffset: patch.cursorOffset ?? this.#state.editor.cursorOffset,
        savedQueryId: patch.savedQueryId === undefined ? this.#state.editor.savedQueryId : (patch.savedQueryId ?? undefined),
      },
    })
  }

  formatEditorQuery(): boolean {
    const text = this.#state.editor.text
    if (!text.trim()) {
      return false
    }

    let formattedText: string
    try {
      formattedText = formatQueryText(text, this.#currentEditorFormatterLanguage())
    } catch {
      return false
    }

    if (formattedText === text) {
      return false
    }

    this.closeEditorSuggestionMenu()
    this.setEditorState({
      cursorOffset: clampCursorOffset(this.#state.editor.cursorOffset, formattedText.length),
      text: formattedText,
    })
    return true
  }

  async saveQueryAsNew(input: SaveQueryAsNewInput): Promise<SavedQuery> {
    const name = input.name.trim()
    const text = input.text ?? this.#state.editor.text
    if (!name) {
      throw new Error("Saved query name is required.")
    }
    if (!text.trim()) {
      throw new Error("Cannot save an empty query.")
    }

    const savedQuery = {
      type: "savedQuery",
      id: createId(),
      createdAt: EpochMillis.now(),
      name,
      protocol: input.protocol ?? this.#currentEditorProtocol(),
      text,
    } satisfies SavedQuery
    await this.persist.savedQueries.upsert(savedQuery)

    this.#setState({
      editor: {
        ...this.#state.editor,
        savedQueryId: savedQuery.id,
      },
      savedQueries: sortSavedQueries([savedQuery, ...this.#state.savedQueries.filter((entry) => entry.id !== savedQuery.id)]),
    })
    return savedQuery
  }

  async saveSavedQueryChanges(input: SaveSavedQueryChangesInput = {}): Promise<SavedQuery> {
    const savedQueryId = this.#state.editor.savedQueryId
    if (!savedQueryId) {
      throw new Error("No saved query loaded.")
    }

    const current = this.#state.savedQueries.find((entry) => entry.id === savedQueryId)
    if (!current) {
      throw new Error("Saved query not found.")
    }

    const name = input.name === undefined ? current.name : input.name.trim()
    const text = input.text ?? this.#state.editor.text
    if (!name) {
      throw new Error("Saved query name is required.")
    }
    if (!text.trim()) {
      throw new Error("Cannot save an empty query.")
    }

    const savedQuery = {
      ...current,
      name,
      protocol: input.protocol ?? this.#currentEditorProtocol() ?? current.protocol,
      text,
      updatedAt: EpochMillis.now(),
    } satisfies SavedQuery
    await this.persist.savedQueries.upsert(savedQuery)

    this.#setState({
      editor: {
        ...this.#state.editor,
        savedQueryId: savedQuery.id,
      },
      savedQueries: sortSavedQueries([savedQuery, ...this.#state.savedQueries.filter((entry) => entry.id !== savedQuery.id)]),
    })
    return savedQuery
  }

  setDetailView(detailView: DetailView) {
    this.#setState({ detailView })
  }

  requestEditorAnalysis(input: RequestEditorAnalysisInput = {}) {
    const text = input.text ?? this.#state.editor.text
    const connectionId = input.connectionId ?? this.#state.selectedConnectionId
    this.#abortEditorAnalysisRequest()

    if (!text.trim() || !connectionId) {
      this.#setState({
        editor: {
          ...this.#state.editor,
          analysis: idleEditorAnalysisState(),
        },
      })
      return
    }

    const connection = this.#requireConnection(connectionId)
    const adapter = this.registry.get(connection.protocol)
    if (!adapter.explain) {
      this.#setState({
        editor: {
          ...this.#state.editor,
          analysis: {
            connectionId,
            requestedText: text,
            result: {
              diagnostics: [],
              status: "unsupported",
            },
            status: "ready",
          },
        },
      })
      return
    }

    const requestId = ++this.#editorAnalysisRequestSerial
    const abortController = new AbortController()
    this.#editorAnalysisAbortController = abortController

    this.#setState({
      editor: {
        ...this.#state.editor,
        analysis: {
          connectionId,
          error: undefined,
          requestedText: text,
          result: undefined,
          status: "loading",
        },
      },
    })

    void this.#loadEditorAnalysis(requestId, {
      abortSignal: abortController.signal,
      connection,
      connectionId,
      parentFlowId: input.parentFlowId,
      text,
    })
  }

  cancelEditorAnalysis() {
    this.#abortEditorAnalysisRequest()
    this.#setState({
      editor: {
        ...this.#state.editor,
        analysis: idleEditorAnalysisState(),
      },
    })
  }

  restoreHistoryEntry(entryId: string) {
    this.restoreQueryExecution(entryId)
  }

  restoreQueryExecution(executionId: string) {
    const execution = this.#state.history.find((historyEntry) => historyEntry.id === executionId)
    if (!execution) {
      return
    }

    this.#currentQueryId = executionId
    this.selectConnection(execution.connectionId)
    this.#syncQueryState()
    this.closeEditorSuggestionMenu()
    this.cancelEditorAnalysis()
    this.setEditorState({
      cursorOffset: execution.sql.source.length,
      savedQueryId: execution.savedQueryId ?? null,
      text: execution.sql.source,
    })
    this.setDetailView(detailViewFromExecution(execution))
  }

  restoreSavedQuery(savedQueryId: string): RestoreSavedQueryResult | undefined {
    const savedQuery = this.#state.savedQueries.find((entry) => entry.id === savedQueryId)
    if (!savedQuery) {
      return undefined
    }

    const execution = findLatestSavedQueryExecution(savedQuery, this.#state.history, this.#state.connections.data ?? [])
    this.#currentQueryId = execution?.id

    const connectionId = this.#resolveSavedQueryConnectionId(savedQuery, execution)
    if (connectionId) {
      this.selectConnection(connectionId)
    } else {
      this.#syncQueryState()
    }

    this.closeEditorSuggestionMenu()
    this.cancelEditorAnalysis()
    this.setEditorState({
      cursorOffset: savedQuery.text.length,
      savedQueryId: savedQuery.id,
      text: savedQuery.text,
    })
    this.setDetailView(execution ? detailViewFromExecution(execution) : emptyDetailView())

    return {
      savedQuery,
      queryExecutionId: execution?.id,
    }
  }

  getQueryState(query: QueryRef): QueryExecutionState {
    const state = this.#queryClient.getQueryState<QueryExecution>(this.#queryExecutionQueryKey(query.queryId))
    const historyEntry = this.#state.history.find((entry) => entry.id === query.queryId)

    if (!state) {
      return historyEntry ? queryExecutionStateFromExecution(historyEntry) : pendingQueryState<QueryExecution>()
    }

    if (state.status !== "error" || state.data) {
      return state
    }

    const execution = state.error instanceof QueryExecutionError ? state.error.execution : historyEntry
    if (!execution) {
      return state
    }

    return {
      ...state,
      data: execution,
      dataUpdateCount: Math.max(state.dataUpdateCount, 1),
      dataUpdatedAt: state.dataUpdatedAt || execution.finishedAt || execution.createdAt,
    }
  }

  cancelQuery(query: QueryRef) {
    void this.#queryClient.cancelQueries(
      {
        exact: true,
        queryKey: this.#queryExecutionQueryKey(query.queryId),
      },
      {
        revert: false,
      },
    )
  }

  cancelRunningQueries() {
    void this.#queryClient.cancelQueries(
      {
        queryKey: [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "query-execution"],
      },
      {
        revert: false,
      },
    )
  }

  cancelActiveQueries() {
    this.cancelRunningQueries()
  }

  runQuery(input: RunQueryInput = {}): QueryRef {
    const text = input.text ?? this.#state.editor.text
    const connectionId = input.connectionId ?? this.#state.selectedConnectionId
    const savedQueryId = this.#state.editor.savedQueryId

    if (input.text !== undefined) {
      this.setEditorState({
        cursorOffset: input.text.length,
        text: input.text,
      })
    }

    if (!text.trim()) {
      throw new Error("Cannot run an empty query.")
    }

    if (!connectionId) {
      throw new Error("No connection selected.")
    }

    const connection = this.#requireConnection(connectionId)
    const queryId = createId()
    const queryRef = {
      queryId,
    } satisfies QueryRef
    const startedAt = Date.now()

    this.#currentQueryId = queryId

    const executionKey = this.#queryExecutionQueryKey(queryId)
    const queryPromise = this.#queryClient.fetchQuery({
      gcTime: Infinity,
      queryKey: executionKey,
      queryFn: async ({ signal }) => {
        signal.throwIfAborted()
        const db = await this.#getQueryRunner(connection)
        signal.throwIfAborted()
        return db.execute(unsafeRawSQL<object>(text), {
          abortSignal: signal,
          executionId: queryId,
          initiator: "user",
          savedQueryId,
        })
      },
      meta: { queryId, text, connectionId, startedAt },
      retry: false,
      staleTime: Infinity,
    })

    this.#syncQueryState()

    void queryPromise
      .then((execution) => {
        const patch: Partial<SqlVisorState> = {
          history: [execution, ...this.#state.history],
        }

        if (this.#currentQueryId === queryId) {
          patch.detailView = {
            kind: "rows",
            title: `Results (${execution.rowCount})`,
            rows: execution.rows,
          }
        }

        this.#setState(patch)
      })
      .catch(async (_error) => {
        const error = _error instanceof Error ? _error : new Error(String(_error))
        const cancelled = isQueryCancellationError(error)
        const execution =
          error instanceof QueryExecutionError
            ? error.execution
            : createSyntheticQueryExecution({
                id: queryId,
                initiator: "user",
                connectionId,
                savedQueryId,
                sessionId: this.session.id,
                sql: text,
                error: cancelled ? "Query cancelled." : error.message,
                errorStack: error.stack,
                status: cancelled ? "cancelled" : "error",
              })

        if (!(error instanceof QueryExecutionError)) {
          try {
            await this.persist.log.upsert(execution)
          } catch {
            // keep in-memory history usable even if persistence fails
          }
        }

        const patch: Partial<SqlVisorState> = {
          history: [execution, ...this.#state.history],
        }

        if (this.#currentQueryId === queryId) {
          patch.detailView = {
            kind: "error",
            title: execution.status === "cancelled" ? "Query Cancelled" : "Query Error",
            message: execution.error ?? error.message,
          }
        }

        this.#setState(patch)
      })
      .finally(() => {
        this.#syncQueryState()
      })

    return queryRef
  }

  openEditorSuggestionMenu(input: OpenEditorSuggestionMenuInput) {
    const scope = this.#resolveEditorSuggestionScope(input.scope)
    this.#abortSuggestionRequest()

    const requestId = ++this.#suggestionRequestSerial
    const abortController = new AbortController()
    this.#suggestionAbortController = abortController
    const previousFocusedItemId = this.#state.editor.suggestionMenu.focusedItemId
    const query = input.trigger.query ?? ""

    this.#setState({
      editor: {
        ...this.#state.editor,
        cursorOffset: input.cursorOffset,
        text: input.documentText,
        suggestionMenu: {
          error: undefined,
          focusedItemId: previousFocusedItemId,
          items: [],
          open: true,
          query,
          replacementRange: input.replacementRange,
          scope,
          status: "loading",
          trigger: input.trigger,
        },
      },
    })

    const request: SuggestionRequest = {
      abortSignal: abortController.signal,
      cursorOffset: input.cursorOffset,
      documentText: input.documentText,
      engine: this,
      replacementRange: input.replacementRange,
      scope,
      trigger: input.trigger,
    }

    void this.#loadSuggestionItems(requestId, request)
  }

  closeEditorSuggestionMenu() {
    this.#abortSuggestionRequest()
    this.#setState({
      editor: {
        ...this.#state.editor,
        suggestionMenu: closedEditorSuggestionMenuState(),
      },
    })
  }

  focusEditorSuggestionMenuItem(input: EditorSuggestionMenuItemFocusInput) {
    const menu = this.#state.editor.suggestionMenu
    if (!menu.open || menu.items.length === 0) {
      return
    }

    let nextFocusedItemId = menu.focusedItemId ?? menu.items[0]?.id

    if ("id" in input) {
      if (menu.items.some((item) => item.id === input.id)) {
        nextFocusedItemId = input.id
      }
    } else if ("index" in input) {
      nextFocusedItemId = menu.items[clamp(input.index, menu.items.length)]?.id
    } else if ("delta" in input) {
      const currentIndex = menu.items.findIndex((item) => item.id === menu.focusedItemId)
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      nextFocusedItemId = menu.items[clamp(baseIndex + input.delta, menu.items.length)]?.id
    }

    if (!nextFocusedItemId || nextFocusedItemId === menu.focusedItemId) {
      return
    }

    this.#setState({
      editor: {
        ...this.#state.editor,
        suggestionMenu: {
          ...menu,
          focusedItemId: nextFocusedItemId,
        },
      },
    })
  }

  applyEditorSuggestionMenuItem(ref?: EditorSuggestionMenuItemRef): boolean {
    const menu = this.#state.editor.suggestionMenu
    const item =
      (ref ? menu.items.find((candidate) => candidate.id === ref.id) : undefined) ??
      menu.items.find((candidate) => candidate.id === menu.focusedItemId) ??
      menu.items[0]

    if (!menu.open || !menu.replacementRange || !item) {
      return false
    }

    const nextText = replaceTextRange(this.#state.editor.text, menu.replacementRange, item.insertText)
    const cursorOffset = menu.replacementRange.start + item.insertText.length
    const suggestionScopeMode = item.connectionId ? "selected-connection" : this.#state.editor.suggestionScopeMode

    this.#abortSuggestionRequest()
    this.#setState({
      editor: {
        ...this.#state.editor,
        cursorOffset,
        suggestionMenu: closedEditorSuggestionMenuState(),
        suggestionScopeMode,
        text: nextText,
      },
    })

    if (item.connectionId) {
      this.selectConnection(item.connectionId)
    }

    return true
  }

  async loadConnectionObjects(connectionId: string): Promise<ObjectInfo[]> {
    const connection = this.#requireConnection(connectionId)

    return this.#queryClient.fetchQuery({
      gcTime: 10 * 60 * 1000,
      queryKey: this.#connectionObjectsQueryKey(connectionId),
      queryFn: async ({ signal }) => {
        signal.throwIfAborted()
        const db = await this.#getQueryRunner(connection)
        signal.throwIfAborted()
        const adapter = this.registry.get(connection.protocol)
        const flow = await db.openFlow({
          initiator: "system",
          name: "load-objects",
        })

        try {
          return await adapter.fetchObjects(db.withFlow(flow))
        } finally {
          await db.closeFlow(flow, { cancelled: signal.aborted })
        }
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

  #resolveEditorSuggestionScope(scope: EditorSuggestionScope | undefined): EditorSuggestionScope {
    if (scope) {
      return scope
    }

    if (this.#state.editor.suggestionScopeMode === "selected-connection" && this.#state.selectedConnectionId) {
      return {
        connectionId: this.#state.selectedConnectionId,
        kind: "selected-connection",
      }
    }

    return {
      kind: "all-connections",
    }
  }

  async #loadSuggestionItems(requestId: number, request: SuggestionRequest) {
    try {
      const providerResults = await Promise.all(
        this.#suggestionProviders.map((provider) => provider.getSuggestions(request)),
      )

      if (request.abortSignal.aborted || requestId !== this.#suggestionRequestSerial) {
        return
      }

      const items = providerResults.flat()
      const focusedItemId = items.some((item) => item.id === this.#state.editor.suggestionMenu.focusedItemId)
        ? this.#state.editor.suggestionMenu.focusedItemId
        : items[0]?.id

      this.#setState({
        editor: {
          ...this.#state.editor,
          suggestionMenu: {
            ...this.#state.editor.suggestionMenu,
            error: undefined,
            focusedItemId,
            items,
            open: true,
            status: "ready",
          },
        },
      })
    } catch (_error) {
      const error = _error instanceof Error ? _error : new Error(String(_error))
      if (request.abortSignal.aborted || isAbortError(error)) {
        return
      }
      if (requestId !== this.#suggestionRequestSerial) {
        return
      }

      this.#setState({
        editor: {
          ...this.#state.editor,
          suggestionMenu: {
            ...this.#state.editor.suggestionMenu,
            error: error.message,
            focusedItemId: undefined,
            items: [],
            open: true,
            status: "error",
          },
        },
      })
    } finally {
      if (this.#suggestionRequestSerial === requestId && this.#suggestionAbortController?.signal === request.abortSignal) {
        this.#suggestionAbortController = undefined
      }
    }
  }

  #abortSuggestionRequest() {
    this.#suggestionAbortController?.abort()
    this.#suggestionAbortController = undefined
  }

  async #loadEditorAnalysis(requestId: number, args: {
    abortSignal: AbortSignal
    connection: Connection<any>
    connectionId: string
    parentFlowId?: string
    text: string
  }) {
    const { abortSignal, connection, connectionId, parentFlowId, text } = args
    const adapter = this.registry.get(connection.protocol)
    if (!adapter.explain) {
      return
    }

    let db: QueryRunnerImpl<any> | undefined
    let flow: QueryFlow | undefined

    try {
      abortSignal.throwIfAborted()
      db = await this.#getQueryRunner(connection)
      abortSignal.throwIfAborted()
      flow = await db.openFlow({
        initiator: "system",
        name: "editor-explain",
        parentFlowId,
      })

      const result = await adapter.explain(db.withFlow(flow), {
        abortSignal,
        text,
      })

      if (abortSignal.aborted || requestId !== this.#editorAnalysisRequestSerial) {
        return
      }

      this.#setState({
        editor: {
          ...this.#state.editor,
          analysis: {
            connectionId,
            error: undefined,
            requestedText: text,
            result,
            status: "ready",
          },
        },
      })
    } catch (_error) {
      const error = _error instanceof Error ? _error : new Error(String(_error))
      if (abortSignal.aborted || isAbortError(error)) {
        return
      }
      if (requestId !== this.#editorAnalysisRequestSerial) {
        return
      }

      this.#setState({
        editor: {
          ...this.#state.editor,
          analysis: {
            connectionId,
            error: error.message,
            requestedText: text,
            result: undefined,
            status: "error",
          },
        },
      })
    } finally {
      if (db && flow) {
        await db.closeFlow(flow, { cancelled: abortSignal.aborted })
      }
      if (this.#editorAnalysisRequestSerial === requestId && this.#editorAnalysisAbortController?.signal === abortSignal) {
        this.#editorAnalysisAbortController = undefined
      }
    }
  }

  #abortEditorAnalysisRequest() {
    this.#editorAnalysisAbortController?.abort()
    this.#editorAnalysisAbortController = undefined
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

    const queryExecution = this.#currentQueryId
      ? this.getQueryState({ queryId: this.#currentQueryId })
      : pendingQueryState<QueryExecution>()

    const queryExecutionKeyPrefix = [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "query-execution"] as const
    const fetchingQueries = this.#queryClient.getQueryCache().findAll({
      queryKey: queryExecutionKeyPrefix,
      fetchStatus: "fetching",
    })
    const activeQueries: ActiveQuery[] = fetchingQueries.map((q) => {
      const meta = q.meta as { queryId?: string; text?: string; connectionId?: string; startedAt?: number } | undefined
      return {
        queryId: meta?.queryId ?? String(q.queryKey[3] ?? ""),
        text: meta?.text ?? "",
        connectionId: meta?.connectionId ?? "",
        startedAt: meta?.startedAt ?? 0,
      }
    })

    this.#replaceState({
      connections,
      queryExecution,
      activeQueries,
      objectsByConnectionId,
    })
  }

  #setState(patch: Partial<SqlVisorState>) {
    this.#state = this.#normalizeState({
      ...this.#state,
      ...patch,
    })
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #replaceState(patch: Pick<SqlVisorState, "connections" | "queryExecution" | "activeQueries" | "objectsByConnectionId">) {
    this.#state = this.#normalizeState({
      ...this.#state,
      ...patch,
    })
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #normalizeState(state: SqlVisorState): SqlVisorState {
    const treeSitterGrammar = this.#resolveEditorTreeSitterGrammar(state)
    if (state.editor.treeSitterGrammar === treeSitterGrammar) {
      return state
    }

    return {
      ...state,
      editor: {
        ...state.editor,
        treeSitterGrammar,
      },
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

  #currentEditorProtocol(): Protocol | undefined {
    return this.#state.connections.data?.find((connection) => connection.id === this.#state.selectedConnectionId)?.protocol
  }

  #currentEditorFormatterLanguage(): string | undefined {
    const protocol = this.#currentEditorProtocol()
    if (!protocol) {
      return undefined
    }

    return this.registry.get(protocol).sqlFormatterLanguage
  }

  #resolveEditorTreeSitterGrammar(state: Pick<SqlVisorState, "connections" | "selectedConnectionId">): string | undefined {
    const connection = state.connections.data?.find((candidate) => candidate.id === state.selectedConnectionId)
    if (!connection) {
      return undefined
    }

    return this.registry.get(connection.protocol).treeSitterGrammar
  }

  #resolveSavedQueryConnectionId(savedQuery: SavedQuery, execution: QueryExecution | undefined): string | undefined {
    if (execution?.connectionId) {
      return execution.connectionId
    }

    const connections = this.#state.connections.data ?? []
    if (!savedQuery.protocol) {
      return this.#state.selectedConnectionId
    }

    const selectedConnection = connections.find((connection) => connection.id === this.#state.selectedConnectionId)
    if (selectedConnection?.protocol === savedQuery.protocol) {
      return selectedConnection.id
    }

    return connections.find((connection) => connection.protocol === savedQuery.protocol)?.id ?? this.#state.selectedConnectionId
  }
}

function builtInAdapters(): AnyAdapter[] {
  return [new TursoAdapter(), new BunSqlAdapter()]
}

function builtInSuggestionProviders(): SuggestionProvider[] {
  return [new KnownObjectsSuggestionProvider()]
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

function clampCursorOffset(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max)
}

function createSyntheticQueryExecution(args: {
  id: string
  initiator: "user" | "system"
  connectionId: string
  savedQueryId?: string
  sessionId: string
  sql: string
  error: string
  errorStack?: string
  status: "error" | "cancelled"
}): QueryExecution {
  const now = EpochMillis.now()
  return {
    type: "queryExecution",
    id: args.id,
    connectionId: args.connectionId,
    sessionId: args.sessionId,
    savedQueryId: args.savedQueryId,
    initiator: args.initiator,
    createdAt: now,
    finishedAt: now,
    sql: {
      source: args.sql,
      args: [],
    },
    sensitive: false,
    status: args.status,
    error: args.error,
    errorStack: args.errorStack,
    rows: [],
    rowCount: 0,
  }
}

function isQueryExecution(entry: LogEntry): entry is QueryExecution {
  return entry.type === "queryExecution"
}

function historySortTime(entry: QueryExecution): number {
  return entry.finishedAt ?? entry.updatedAt ?? entry.createdAt
}

function savedQuerySortTime(query: SavedQuery): number {
  return query.updatedAt ?? query.createdAt
}

function sortSavedQueries(savedQueries: SavedQuery[]): SavedQuery[] {
  return savedQueries.toSorted((a, b) => savedQuerySortTime(b) - savedQuerySortTime(a))
}

function findLatestSavedQueryExecution(
  savedQuery: SavedQuery,
  history: QueryExecution[],
  connections: Connection<any>[],
): QueryExecution | undefined {
  const protocolByConnectionId = new Map(connections.map((connection) => [connection.id, connection.protocol]))

  return (
    history.find((entry) => entry.savedQueryId === savedQuery.id) ??
    history.find(
      (entry) =>
        entry.sql.source === savedQuery.text &&
        (savedQuery.protocol === undefined || protocolByConnectionId.get(entry.connectionId) === savedQuery.protocol),
    )
  )
}

function detailViewFromExecution(execution: QueryExecution): DetailView {
  if (execution.status !== "success") {
    return {
      kind: "error",
      title: execution.status === "cancelled" ? "Query Cancelled" : "Query Error",
      message: execution.error ?? "Query failed.",
    }
  }

  return {
    kind: "rows",
    title: `Results (${execution.rowCount})`,
    rows: execution.rows,
  }
}

function emptyDetailView(): DetailView {
  return {
    kind: "empty",
    title: "Results",
    message: "No query run selected",
  }
}

function queryExecutionStateFromExecution(execution: QueryExecution): QueryExecutionState {
  const error = execution.status === "success" ? null : new QueryExecutionError(execution)

  return {
    data: execution,
    dataUpdateCount: 1,
    dataUpdatedAt: execution.finishedAt || execution.createdAt,
    error,
    errorUpdateCount: error ? 1 : 0,
    errorUpdatedAt: error ? execution.finishedAt || execution.createdAt : 0,
    fetchFailureCount: error ? 1 : 0,
    fetchFailureReason: error,
    fetchMeta: null,
    isInvalidated: false,
    status: error ? "error" : execution.status === "pending" ? "pending" : "success",
    fetchStatus: execution.status === "pending" ? "fetching" : "idle",
  }
}

function isQueryCancellationError(error: Error): boolean {
  return error instanceof CancelledError || error.name === "AbortError"
}

function isAbortError(error: Error): boolean {
  return error.name === "AbortError"
}

function closedEditorSuggestionMenuState(): EditorSuggestionMenuState {
  return {
    items: [],
    open: false,
    query: "",
    status: "closed",
  }
}

function idleEditorAnalysisState(): EditorAnalysisState {
  return {
    status: "idle",
  }
}

function replaceTextRange(text: string, range: EditorRange, replacement: string): string {
  return text.slice(0, range.start) + replacement + text.slice(range.end)
}

function clamp(index: number, length: number): number {
  if (length <= 1) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}
