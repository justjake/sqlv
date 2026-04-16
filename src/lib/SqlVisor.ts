import { CancelledError, QueryClient } from "@tanstack/query-core"
import { BunSqlAdapter } from "./adapters/BunSqlAdapter"
import { PostgresAdapter } from "./adapters/postgres"
import { sqlite } from "./adapters/sqlite"
import { TursoAdapter } from "./adapters/TursoAdapter"
import { createLocalPersistence, type LocalPersistence, type PersistenceStore } from "./createLocalPersistence"
import {
  createEditorAnalysisSubject,
  idleEditorAnalysisState,
  type EditorAnalysisState,
  type EditorAnalysisSubject,
} from "./editor/analysis"
import {
  applyEditorBufferPatch,
  clampCursorOffset,
  type EditorBuffer,
  type EditorBufferPatch,
  type EditorChange,
} from "./editor/buffer"
import {
  closedEditorCompletionState,
  decideEditorCompletion,
  type EditorCompletionContext,
  type EditorCompletionItemFocusInput,
  type EditorCompletionItemRef,
  type EditorCompletionScope,
  type EditorCompletionScopeMode,
  type EditorCompletionState,
  type SuggestionItem,
} from "./editor/completion"
import { createEmptyEditorState, type EditorState } from "./editor/state"
import { replaceTextRange, type EditorRange } from "./editor/text"
import { formatQueryText } from "./formatQuery"
import { AdapterRegistry, type AnyAdapter, type Protocol, type ProtocolConfig } from "./interface/Adapter"
import { findLatestSavedQueryExecution } from "./queryExecution"
import { QueryExecutionError, QueryRunnerImpl } from "./QueryRunnerImpl"
import { KnownObjectsSuggestionProvider } from "./suggestions/KnownObjectsSuggestionProvider"
import type { SuggestionProvider, SuggestionRequest } from "./suggestions/types"
import { selectStoredRows } from "./sqliteRowStore"
import type { Connection } from "./types/Connection"
import { createId } from "./types/Id"
import { EpochMillis, type LogEntry, type QueryExecution, type QueryFlow, type Session } from "./types/Log"
import type { ObjectInfo } from "./types/objects"
import { OrderString } from "./types/Order"
import { pendingQueryState, queryStateOrPending, type QueryState } from "./types/QueryState"
import type { SavedQuery } from "./types/SavedQuery"
import {
  defaultSettingsState,
  type AnySettingsRow,
  type SettingsId,
  type SettingsRow,
  type SettingsSchema,
  type SettingsState,
} from "./types/Settings"
import { unsafeRawSQL } from "./types/SQL"

export type {
  EditorAnalysisState,
  EditorAnalysisSubject,
  EditorBuffer,
  EditorChange,
  EditorCompletionContext,
  EditorCompletionItemFocusInput,
  EditorCompletionItemRef,
  EditorCompletionScope,
  EditorCompletionScopeMode,
  EditorCompletionState,
  EditorState,
  EditorRange,
  SuggestionItem,
}

export type ConnectionsState = QueryState<Connection<any>[]>
export type ConnectionSuggestionsState = QueryState<DiscoveredConnectionSuggestion[]>
export type ConnectionObjectsState = QueryState<ObjectInfo[]>
export type QueryExecutionState = QueryState<QueryExecution>

export type DiscoveredConnectionSuggestion<P extends Protocol = Protocol> = {
  id: string
  protocol: P
  name: string
  config: Partial<ProtocolConfig<P>>
}

export type QueryRef = {
  queryId: string
}

export type SqlVisorState = {
  sessionId: string
  connections: ConnectionsState
  connectionSuggestions: ConnectionSuggestionsState
  selectedConnectionId?: string
  selectedQueryExecutionId: string | null
  editor: EditorState
  history: QueryExecution[]
  savedQueries: SavedQuery[]
  settings: SettingsState
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
type SettingsRowMap = Partial<Record<SettingsId, AnySettingsRow>>

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

    await engine.#loadPersistedSettings()
    await engine.refreshConnections()
    await engine.#loadPersistedHistory()
    await engine.#loadPersistedSavedQueries()
    void engine.refreshConnectionSuggestions().catch(() => undefined)
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
  #suggestionAbortController: AbortController | undefined
  #suggestionRequestSerial = 0
  #editorAnalysisAbortController: AbortController | undefined
  #editorAnalysisRequestSerial = 0
  #settingsRows: SettingsRowMap = {}
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
      connectionSuggestions: pendingQueryState<DiscoveredConnectionSuggestion[]>(),
      selectedConnectionId: undefined,
      selectedQueryExecutionId: null,
      editor: createEmptyEditorState(),
      history: [],
      savedQueries: [],
      settings: defaultSettingsState(),
      queryExecution: pendingQueryState<QueryExecution>(),
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

    const selectedConnectionId = this.#resolveSelectedConnectionId(connections)
    this.#applySelectedConnection(selectedConnectionId)

    return connections
  }

  async refreshConnectionSuggestions(): Promise<DiscoveredConnectionSuggestion[]> {
    const suggestions = await this.#queryClient.fetchQuery({
      gcTime: 5 * 60 * 1000,
      queryKey: this.#connectionSuggestionsQueryKey(),
      queryFn: async () => this.#findConnectionSuggestions(),
      retry: false,
      staleTime: 0,
    })
    this.#syncQueryState()
    return suggestions
  }

  async #loadPersistedHistory(): Promise<void> {
    const logEntries = await this.persist.log.query(
      (table) => sqlite<LogEntry>`
        ${selectStoredRows<LogEntry>(table)}
        ORDER BY COALESCE(updatedAt, createdAt) DESC
      `,
    )
    const history = logEntries.filter(isQueryExecution).sort((a, b) => historySortTime(b) - historySortTime(a))
    const selectedQueryExecutionId = resolveSelectedQueryExecutionId(this.#state.selectedQueryExecutionId, history)
    this.#setState({
      history,
      queryExecution: selectedQueryExecutionId ? queryExecutionStateFromExecution(history.find((entry) => entry.id === selectedQueryExecutionId)!) : pendingQueryState(),
      selectedQueryExecutionId,
    })
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

  async #loadPersistedSettings(): Promise<void> {
    const rows = await this.persist.settings.query(
      (table) => sqlite<AnySettingsRow>`
        ${selectStoredRows<AnySettingsRow>(table)}
        ORDER BY createdAt ASC
      `,
    )
    this.#replaceSettingsRows(rows)
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
    void this.refreshConnectionSuggestions().catch(() => undefined)
    this.selectConnection(connection.id)
    return connection
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const connection = this.#requireConnection(connectionId)
    if (connectionId === this.#state.selectedConnectionId) {
      this.#abortEditorAnalysisRequest()
    }

    this.#queryRunners.get(connection.id)?.cancelAll()
    this.#queryRunners.delete(connection.id)

    await this.persist.connections.delete({
      id: connection.id,
      type: "connection",
    })
    this.#queryClient.removeQueries({
      exact: true,
      queryKey: this.#connectionObjectsQueryKey(connection.id),
    })
    await this.#queryClient.invalidateQueries({
      exact: true,
      queryKey: this.#connectionsQueryKey(),
    })
    await this.refreshConnections()
    void this.refreshConnectionSuggestions().catch(() => undefined)
  }

  selectConnection(connectionId: string | undefined) {
    this.#applySelectedConnection(connectionId)
  }

  selectQueryExecution(queryExecutionId: string | null) {
    if (queryExecutionId !== null && !this.#state.history.some((entry) => entry.id === queryExecutionId)) {
      return
    }

    this.#setState({
      selectedQueryExecutionId: queryExecutionId,
      queryExecution: queryExecutionId ? this.getQueryState({ queryId: queryExecutionId }) : pendingQueryState(),
    })
  }

  setEditorBuffer(
    patch: EditorBufferPatch & {
      savedQueryId?: string | null
    },
  ) {
    const buffer = applyEditorBufferPatch(this.#state.editor.buffer, patch)
    if (buffer === this.#state.editor.buffer && patch.savedQueryId === undefined) {
      return
    }

    this.#setState({
      editor: {
        ...this.#state.editor,
        buffer,
        savedQueryId:
          patch.savedQueryId === undefined ? this.#state.editor.savedQueryId : (patch.savedQueryId ?? undefined),
      },
    })
  }

  applyEditorChange(change: EditorChange) {
    if (change.next === this.#state.editor.buffer) {
      return
    }

    const completionDecision = decideEditorCompletion({
      change,
      completion: this.#state.editor.completion,
      scopeMode: this.#state.editor.completionScopeMode,
      selectedConnectionId: this.#state.selectedConnectionId,
    })

    if (completionDecision.kind === "open") {
      this.#openEditorCompletion(completionDecision.context, change.next)
      return
    }

    if (completionDecision.kind === "close") {
      this.#abortSuggestionRequest()
      this.#setState({
        editor: {
          ...this.#state.editor,
          buffer: change.next,
          completion: closedEditorCompletionState(),
        },
      })
      return
    }

    this.#setState({
      editor: {
        ...this.#state.editor,
        buffer: change.next,
      },
    })
  }

  formatEditorQuery(): boolean {
    const text = this.#state.editor.buffer.text
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

    this.closeEditorCompletion()
    this.setEditorBuffer({
      cursorOffset: clampCursorOffset(this.#state.editor.buffer.cursorOffset, formattedText.length),
      text: formattedText,
    })
    return true
  }

  async saveQueryAsNew(input: SaveQueryAsNewInput): Promise<SavedQuery> {
    const name = input.name.trim()
    const text = input.text ?? this.#state.editor.buffer.text
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
      savedQueries: sortSavedQueries([
        savedQuery,
        ...this.#state.savedQueries.filter((entry) => entry.id !== savedQuery.id),
      ]),
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
    const text = input.text ?? this.#state.editor.buffer.text
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
      savedQueries: sortSavedQueries([
        savedQuery,
        ...this.#state.savedQueries.filter((entry) => entry.id !== savedQuery.id),
      ]),
    })
    return savedQuery
  }

  async updateSettings<Id extends SettingsId>(id: Id, patch: Partial<SettingsSchema[Id]>): Promise<SettingsSchema[Id]> {
    return this.replaceSettings(id, {
      ...this.#state.settings[id],
      ...patch,
    })
  }

  async replaceSettings<Id extends SettingsId>(id: Id, settings: SettingsSchema[Id]): Promise<SettingsSchema[Id]> {
    const now = EpochMillis.now()
    const currentRow = this.#settingsRows[id] as SettingsRow<Id> | undefined
    const nextRow: SettingsRow<Id> = {
      createdAt: currentRow?.createdAt ?? now,
      id,
      settings,
      type: "settings",
      updatedAt: currentRow ? now : undefined,
    }
    const persistedRow = (await this.persist.settings.upsert(nextRow as AnySettingsRow)) as SettingsRow<Id>
    this.#applySettingsRow(persistedRow)
    return persistedRow.settings
  }

  requestEditorAnalysis(parentFlowId?: string) {
    const buffer = this.#state.editor.buffer
    const connectionId = this.#state.selectedConnectionId
    const subject = createEditorAnalysisSubject(buffer, connectionId)
    this.#abortEditorAnalysisRequest()

    if (!subject.text.trim() || !connectionId) {
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
            result: {
              diagnostics: [],
              status: "unsupported",
            },
            status: "ready",
            subject,
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
          error: undefined,
          result: undefined,
          status: "loading",
          subject,
        },
      },
    })

    void this.#loadEditorAnalysis(requestId, {
      abortSignal: abortController.signal,
      connection,
      parentFlowId,
      subject,
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

    this.selectQueryExecution(executionId)
    const restoredConnectionId = this.#findConnection(execution.connectionId)?.id
    this.#applySelectedConnection(restoredConnectionId, {
      persistSidebarSelection: restoredConnectionId !== undefined,
    })
    this.closeEditorCompletion()
    this.cancelEditorAnalysis()
    this.setEditorBuffer({
      cursorOffset: execution.sql.source.length,
      savedQueryId: execution.savedQueryId ?? null,
      text: execution.sql.source,
    })
  }

  restoreSavedQuery(savedQueryId: string): RestoreSavedQueryResult | undefined {
    const savedQuery = this.#state.savedQueries.find((entry) => entry.id === savedQueryId)
    if (!savedQuery) {
      return undefined
    }

    const execution = findLatestSavedQueryExecution(savedQuery, this.#state.history, this.#state.connections.data ?? [])
    this.selectQueryExecution(execution?.id ?? null)

    const connectionId = this.#resolveSavedQueryConnectionId(savedQuery, execution)
    if (connectionId) {
      this.selectConnection(connectionId)
    }

    this.closeEditorCompletion()
    this.cancelEditorAnalysis()
    this.setEditorBuffer({
      cursorOffset: savedQuery.text.length,
      savedQueryId: savedQuery.id,
      text: savedQuery.text,
    })

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

    if (state.data) {
      return state
    }

    const execution =
      historyEntry ?? (state.error instanceof QueryExecutionError ? state.error.execution : undefined)
    if (!execution) {
      return state
    }

    const derived = queryExecutionStateFromExecution(execution)
    return {
      ...state,
      data: execution,
      dataUpdateCount: Math.max(state.dataUpdateCount, derived.dataUpdateCount),
      dataUpdatedAt: state.dataUpdatedAt || derived.dataUpdatedAt,
      error: derived.error ?? state.error,
      errorUpdateCount: Math.max(state.errorUpdateCount, derived.errorUpdateCount),
      errorUpdatedAt: state.errorUpdatedAt || derived.errorUpdatedAt,
      fetchFailureCount: Math.max(state.fetchFailureCount, derived.fetchFailureCount),
      fetchFailureReason: state.fetchFailureReason ?? derived.fetchFailureReason,
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
    const text = input.text ?? this.#state.editor.buffer.text
    const connectionId = input.connectionId ?? this.#state.selectedConnectionId
    const savedQueryId = this.#state.editor.savedQueryId

    if (input.text !== undefined) {
      this.setEditorBuffer({
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
    const createdAt = EpochMillis.now()
    const pendingExecution = createPendingQueryExecution({
      connectionId,
      createdAt,
      id: queryId,
      initiator: "user",
      savedQueryId,
      sessionId: this.session.id,
      sql: text,
    })

    this.#setState({
      history: prependHistoryExecution(this.#state.history, pendingExecution),
      queryExecution: queryExecutionStateFromExecution(pendingExecution),
      selectedQueryExecutionId: queryId,
    })

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
      retry: false,
      staleTime: Infinity,
    })

    void queryPromise
      .then((execution) => {
        this.#setState({
          history: replaceHistoryExecution(this.#state.history, execution),
          queryExecution:
            this.#state.selectedQueryExecutionId === queryId
              ? queryExecutionStateFromExecution(execution)
              : this.#state.queryExecution,
        })
      })
      .catch(async (_error) => {
        const error = _error instanceof Error ? _error : new Error(String(_error))
        const cancelled = isQueryCancellationError(error)
        const execution =
          error instanceof QueryExecutionError
            ? error.execution
            : createSyntheticQueryExecution({
                createdAt: pendingExecution.createdAt,
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

        this.#setState({
          history: replaceHistoryExecution(this.#state.history, execution),
          queryExecution:
            this.#state.selectedQueryExecutionId === queryId
              ? queryExecutionStateFromExecution(execution)
              : this.#state.queryExecution,
        })
      })
      .finally(() => {
        this.#syncQueryState()
      })

    return queryRef
  }

  openEditorCompletion(context: EditorCompletionContext) {
    this.#openEditorCompletion(context, this.#state.editor.buffer)
  }

  closeEditorCompletion() {
    this.#abortSuggestionRequest()
    this.#setState({
      editor: {
        ...this.#state.editor,
        completion: closedEditorCompletionState(),
      },
    })
  }

  focusEditorCompletionItem(input: EditorCompletionItemFocusInput) {
    const completion = this.#state.editor.completion
    if (completion.status === "closed" || completion.items.length === 0) {
      return
    }

    let nextFocusedItemId = completion.focusedItemId ?? completion.items[0]?.id

    if ("id" in input) {
      if (completion.items.some((item) => item.id === input.id)) {
        nextFocusedItemId = input.id
      }
    } else if ("index" in input) {
      nextFocusedItemId = completion.items[clamp(input.index, completion.items.length)]?.id
    } else if ("delta" in input) {
      const currentIndex = completion.items.findIndex((item) => item.id === completion.focusedItemId)
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      nextFocusedItemId = completion.items[clamp(baseIndex + input.delta, completion.items.length)]?.id
    }

    if (!nextFocusedItemId || nextFocusedItemId === completion.focusedItemId) {
      return
    }

    this.#setState({
      editor: {
        ...this.#state.editor,
        completion: {
          ...completion,
          focusedItemId: nextFocusedItemId,
        },
      },
    })
  }

  applyEditorCompletionItem(ref?: EditorCompletionItemRef): boolean {
    const completion = this.#state.editor.completion
    const item =
      (ref ? completion.items.find((candidate) => candidate.id === ref.id) : undefined) ??
      completion.items.find((candidate) => candidate.id === completion.focusedItemId) ??
      completion.items[0]

    if (completion.status === "closed" || !completion.context || !item) {
      return false
    }

    const nextText = replaceTextRange(this.#state.editor.buffer.text, completion.context.replaceRange, item.insertText)
    const completionScopeMode = item.connectionId ? "selected-connection" : this.#state.editor.completionScopeMode

    this.#abortSuggestionRequest()
    this.#setState({
      editor: {
        ...this.#state.editor,
        buffer: applyEditorBufferPatch(this.#state.editor.buffer, {
          cursorOffset: completion.context.replaceRange.start + item.insertText.length,
          text: nextText,
        }),
        completion: closedEditorCompletionState(),
        completionScopeMode,
      },
    })

    if (item.connectionId) {
      this.selectConnection(item.connectionId)
    }

    return true
  }

  #openEditorCompletion(context: EditorCompletionContext, buffer: EditorBuffer) {
    this.#abortSuggestionRequest()

    const requestId = ++this.#suggestionRequestSerial
    const abortController = new AbortController()
    this.#suggestionAbortController = abortController
    const previousFocusedItemId = this.#state.editor.completion.focusedItemId

    this.#setState({
      editor: {
        ...this.#state.editor,
        buffer,
        completion: {
          context,
          error: undefined,
          focusedItemId: previousFocusedItemId,
          items: [],
          status: "loading",
        },
      },
    })

    const request: SuggestionRequest = {
      abortSignal: abortController.signal,
      buffer,
      completion: context,
      engine: this,
    }

    void this.#loadSuggestionItems(requestId, request)
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

  #applySelectedConnection(
    connectionId: string | undefined,
    options: {
      persistSidebarSelection?: boolean
    } = {},
  ) {
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

    if (options.persistSidebarSelection ?? true) {
      this.#persistSidebarSelection(connectionId)
    }

    if (connectionId && this.#findConnection(connectionId)) {
      void this.loadConnectionObjects(connectionId).catch(() => undefined)
    }
  }

  #findConnection(connectionId: string | undefined): Connection<any> | undefined {
    if (!connectionId) {
      return undefined
    }

    return this.#state.connections.data?.find((candidate) => candidate.id === connectionId)
  }

  async #findConnectionSuggestions(): Promise<DiscoveredConnectionSuggestion[]> {
    const adapters = this.registry.list()
    const connections = this.#state.connections.data ?? []
    const results = await Promise.all(
      adapters.map(async (adapter) => {
        if (!adapter.findConnections) {
          return []
        }

        const suggestions = await adapter.findConnections()
        return suggestions
          .filter((suggestion) => !matchesExistingConnection(connections, adapter.protocol, suggestion.config))
          .map((suggestion, index) => ({
            config: suggestion.config,
            id: discoveredConnectionSuggestionId(adapter.protocol, suggestion, index),
            name: suggestion.name,
            protocol: adapter.protocol,
          }) satisfies DiscoveredConnectionSuggestion)
      }),
    )

    const suggestionById = new Map<string, DiscoveredConnectionSuggestion>()
    for (const suggestion of results.flat()) {
      suggestionById.set(suggestion.id, suggestion)
    }

    return [...suggestionById.values()].toSorted(
      (left, right) => left.protocol.localeCompare(right.protocol) || left.name.localeCompare(right.name),
    )
  }

  #requireConnection(connectionId: string): Connection<any> {
    const connection = this.#findConnection(connectionId)
    if (!connection) {
      throw new Error(`Unknown connection: ${connectionId}`)
    }
    return connection
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
      const focusedItemId = items.some((item) => item.id === this.#state.editor.completion.focusedItemId)
        ? this.#state.editor.completion.focusedItemId
        : items[0]?.id

      this.#setState({
        editor: {
          ...this.#state.editor,
          completion: {
            ...this.#state.editor.completion,
            error: undefined,
            focusedItemId,
            items,
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
          completion: {
            ...this.#state.editor.completion,
            error: error.message,
            focusedItemId: undefined,
            items: [],
            status: "error",
          },
        },
      })
    } finally {
      if (
        this.#suggestionRequestSerial === requestId &&
        this.#suggestionAbortController?.signal === request.abortSignal
      ) {
        this.#suggestionAbortController = undefined
      }
    }
  }

  #abortSuggestionRequest() {
    this.#suggestionAbortController?.abort()
    this.#suggestionAbortController = undefined
  }

  async #loadEditorAnalysis(
    requestId: number,
    args: {
      abortSignal: AbortSignal
      connection: Connection<any>
      parentFlowId?: string
      subject: EditorAnalysisSubject
    },
  ) {
    const { abortSignal, connection, parentFlowId, subject } = args
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
        text: subject.text,
      })

      if (abortSignal.aborted || requestId !== this.#editorAnalysisRequestSerial) {
        return
      }

      this.#setState({
        editor: {
          ...this.#state.editor,
          analysis: {
            error: undefined,
            result,
            status: "ready",
            subject,
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
            error: error.message,
            result: undefined,
            status: "error",
            subject,
          },
        },
      })
    } finally {
      if (db && flow) {
        await db.closeFlow(flow, { cancelled: abortSignal.aborted })
      }
      if (
        this.#editorAnalysisRequestSerial === requestId &&
        this.#editorAnalysisAbortController?.signal === abortSignal
      ) {
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
    const connectionSuggestions = queryStateOrPending(
      this.#queryClient.getQueryState<DiscoveredConnectionSuggestion[]>(this.#connectionSuggestionsQueryKey()),
    )
    const knownConnectionIds = new Set((connections.data ?? []).map((connection) => connection.id))
    const connectionIds = new Set<string>()
    if (this.#state.selectedConnectionId && knownConnectionIds.has(this.#state.selectedConnectionId)) {
      connectionIds.add(this.#state.selectedConnectionId)
    }
    for (const connectionId of Object.keys(this.#state.objectsByConnectionId)) {
      if (knownConnectionIds.has(connectionId)) {
        connectionIds.add(connectionId)
      }
    }

    const objectsByConnectionId: Record<string, ConnectionObjectsState> = {}
    for (const connectionId of connectionIds) {
      objectsByConnectionId[connectionId] = queryStateOrPending(
        this.#queryClient.getQueryState<ObjectInfo[]>(this.#connectionObjectsQueryKey(connectionId)),
      )
    }

    const queryExecution = this.#state.selectedQueryExecutionId
      ? this.getQueryState({ queryId: this.#state.selectedQueryExecutionId })
      : pendingQueryState<QueryExecution>()

    this.#replaceState({
      connections,
      connectionSuggestions,
      queryExecution,
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

  #replaceState(
    patch: Pick<
      SqlVisorState,
      "connections" | "connectionSuggestions" | "queryExecution" | "objectsByConnectionId"
    >,
  ) {
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

  #connectionSuggestionsQueryKey(): readonly ["sqlvisor", string, "connection-suggestions"] {
    return [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "connection-suggestions"]
  }

  #connectionObjectsQueryKey(connectionId: string): readonly ["sqlvisor", string, "connections", string, "objects"] {
    return [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "connections", connectionId, "objects"]
  }

  #queryExecutionQueryKey(executionId: string): readonly ["sqlvisor", string, "query-execution", string] {
    return [this.#queryKeyPrefix[0], this.#queryKeyPrefix[1], "query-execution", executionId]
  }

  #currentEditorProtocol(): Protocol | undefined {
    return this.#state.connections.data?.find((connection) => connection.id === this.#state.selectedConnectionId)
      ?.protocol
  }

  #resolveSelectedConnectionId(connections: Connection<any>[]): string | undefined {
    if (connections.some((connection) => connection.id === this.#state.selectedConnectionId)) {
      return this.#state.selectedConnectionId
    }

    const persistedConnectionId = this.#state.settings.sidebarState.lastSelectedConnectionId
    if (persistedConnectionId && connections.some((connection) => connection.id === persistedConnectionId)) {
      return persistedConnectionId
    }

    return connections[0]?.id
  }

  #persistSidebarSelection(connectionId: string | undefined) {
    const lastSelectedConnectionId = connectionId ?? ""
    if (this.#state.settings.sidebarState.lastSelectedConnectionId === lastSelectedConnectionId) {
      return
    }

    void this.replaceSettings("sidebarState", {
      lastSelectedConnectionId,
    })
  }

  #currentEditorFormatterLanguage(): string | undefined {
    const protocol = this.#currentEditorProtocol()
    if (!protocol) {
      return undefined
    }

    return this.registry.get(protocol).sqlFormatterLanguage
  }

  #resolveEditorTreeSitterGrammar(
    state: Pick<SqlVisorState, "connections" | "selectedConnectionId">,
  ): string | undefined {
    const connection = state.connections.data?.find((candidate) => candidate.id === state.selectedConnectionId)
    if (!connection) {
      return undefined
    }

    return this.registry.get(connection.protocol).treeSitterGrammar
  }

  #resolveSavedQueryConnectionId(savedQuery: SavedQuery, execution: QueryExecution | undefined): string | undefined {
    if (execution?.connectionId && this.#findConnection(execution.connectionId)) {
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

    return (
      connections.find((connection) => connection.protocol === savedQuery.protocol)?.id ??
      this.#state.selectedConnectionId
    )
  }

  #replaceSettingsRows(rows: AnySettingsRow[]) {
    const settingsRows = {} as SettingsRowMap
    const settings = defaultSettingsState()
    const settingsRecord = settings as Record<SettingsId, SettingsSchema[SettingsId]>

    for (const row of rows) {
      settingsRows[row.id] = row as AnySettingsRow
      settingsRecord[row.id] = row.settings
    }

    this.#settingsRows = settingsRows
    this.#setState({ settings })
  }

  #applySettingsRow<Id extends SettingsId>(row: SettingsRow<Id>) {
    this.#settingsRows = {
      ...this.#settingsRows,
      [row.id]: row,
    }
    this.#setState({
      settings: {
        ...this.#state.settings,
        [row.id]: row.settings,
      } as SettingsState,
    })
  }
}

function builtInAdapters(): AnyAdapter[] {
  return [new TursoAdapter(), new BunSqlAdapter(), new PostgresAdapter()]
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

function createPendingQueryExecution(args: {
  id: string
  initiator: "user" | "system"
  connectionId: string
  createdAt: number
  savedQueryId?: string
  sessionId: string
  sql: string
}): QueryExecution {
  return {
    type: "queryExecution",
    id: args.id,
    connectionId: args.connectionId,
    sessionId: args.sessionId,
    savedQueryId: args.savedQueryId,
    initiator: args.initiator,
    createdAt: EpochMillis(args.createdAt),
    sql: {
      source: args.sql,
      args: [],
    },
    sensitive: false,
    status: "pending",
    rows: [],
    rowCount: 0,
  }
}

function createSyntheticQueryExecution(args: {
  createdAt?: number
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
    createdAt: args.createdAt === undefined ? now : EpochMillis(args.createdAt),
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

function prependHistoryExecution(history: QueryExecution[], execution: QueryExecution): QueryExecution[] {
  const withoutExisting = history.filter((entry) => entry.id !== execution.id)
  return [execution, ...withoutExisting]
}

function replaceHistoryExecution(history: QueryExecution[], execution: QueryExecution): QueryExecution[] {
  const nextHistory = history.map((entry) => (entry.id === execution.id ? execution : entry))
  return nextHistory.some((entry) => entry.id === execution.id) ? nextHistory : prependHistoryExecution(history, execution)
}

function resolveSelectedQueryExecutionId(
  selectedQueryExecutionId: string | null,
  history: QueryExecution[],
): string | null {
  if (selectedQueryExecutionId && history.some((entry) => entry.id === selectedQueryExecutionId)) {
    return selectedQueryExecutionId
  }

  return history[0]?.id ?? null
}

function discoveredConnectionSuggestionId(
  protocol: Protocol,
  suggestion: {
    name: string
    config: object
  },
  index: number,
): string {
  return `${protocol}:${suggestion.name}:${stableJsonSignature(suggestion.config)}:${index}`
}

function stableJsonSignature(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }

  if (value && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonValue(child)])
    return Object.fromEntries(sortedEntries)
  }

  return value
}

function matchesExistingConnection(
  connections: Connection<any>[],
  protocol: Protocol,
  suggestionConfig: object,
): boolean {
  return connections.some(
    (connection) => connection.protocol === protocol && partialConfigMatches(connection.config, suggestionConfig),
  )
}

function partialConfigMatches(actual: unknown, partial: unknown): boolean {
  if (partial === undefined) {
    return true
  }

  if (
    partial === null ||
    typeof partial !== "object" ||
    actual === null ||
    typeof actual !== "object" ||
    Array.isArray(partial) ||
    Array.isArray(actual)
  ) {
    return Object.is(actual, partial)
  }

  return Object.entries(partial).every(([key, value]) => partialConfigMatches((actual as Record<string, unknown>)[key], value))
}

function clamp(index: number, length: number): number {
  if (length <= 1) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}
