import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunSqlAdapter, type BunSqlConfig } from "../src/lib/adapters/BunSqlAdapter"
import { PostgresAdapter } from "../src/lib/adapters/postgres"
import { TursoAdapter } from "../src/lib/adapters/TursoAdapter"
import { createSession } from "../src/lib/createLocalPersistence"
import { createNoopLogStore } from "../src/lib/createNoopLogStore"
import {
  createEditorAnalysisSubject,
  idleEditorAnalysisState,
  type EditorAnalysisState,
} from "../src/lib/editor/analysis"
import {
  applyEditorBufferPatch,
  type EditorBufferPatch,
  type EditorChange,
} from "../src/lib/editor/buffer"
import {
  closedEditorCompletionState,
  decideEditorCompletion,
  type EditorCompletionContext,
  type EditorCompletionItemFocusInput,
  type EditorCompletionItemRef,
  type EditorCompletionState,
} from "../src/lib/editor/completion"
import { createEmptyEditorState, type EditorState } from "../src/lib/editor/state"
import { replaceTextRange } from "../src/lib/editor/text"
import { AdapterRegistry, type Protocol } from "../src/lib/interface/Adapter"
import { findLatestSavedQueryExecution } from "../src/lib/queryExecution"
import { QueryRunnerImpl } from "../src/lib/QueryRunnerImpl"
import {
  type AddConnectionInput,
  type QueryRef,
  type RestoreSavedQueryResult,
  type RunQueryInput,
  type SaveQueryAsNewInput,
  type SaveSavedQueryChangesInput,
  type SqlVisor,
  type SqlVisorState,
} from "../src/lib/SqlVisor"
import type { ExplainResult } from "../src/lib/types/Explain"
import type { Connection } from "../src/lib/types/Connection"
import { EpochMillis, type QueryExecution, type QueryInitiator } from "../src/lib/types/Log"
import type { ObjectInfo } from "../src/lib/types/objects"
import { OrderString } from "../src/lib/types/Order"
import { pendingQueryState, type QueryState } from "../src/lib/types/QueryState"
import type { SavedQuery } from "../src/lib/types/SavedQuery"
import {
  defaultSettingsState,
  type SettingsId,
  type SettingsRow,
  type SettingsSchema,
  type SettingsState,
} from "../src/lib/types/Settings"

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
    savedQueryId?: string
    sessionId?: string
    sql?: string
    rows?: object[]
    error?: string
    status?: QueryExecution["status"]
    createdAt?: number
    finishedAt?: number
    initiator?: QueryInitiator
    parentFlowId?: string
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
    savedQueryId: args.savedQueryId,
    initiator: args.initiator ?? "user",
    parentFlowId: args.parentFlowId,
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

export function makeSavedQuery(
  args: {
    id?: string
    name?: string
    text?: string
    protocol?: SavedQuery["protocol"]
    createdAt?: number
    updatedAt?: number
  } = {},
): SavedQuery {
  return {
    type: "savedQuery",
    id: args.id ?? "saved-query-1",
    createdAt: EpochMillis(args.createdAt ?? 1),
    updatedAt: args.updatedAt === undefined ? undefined : EpochMillis(args.updatedAt),
    name: args.name ?? "Saved Query",
    protocol: args.protocol,
    text: args.text ?? "select 1",
  }
}

export function makeSettingsRow<Id extends SettingsId>(
  id: Id,
  settings: SettingsSchema[Id],
  args: {
    createdAt?: number
    updatedAt?: number
  } = {},
): SettingsRow<Id> {
  return {
    createdAt: EpochMillis(args.createdAt ?? 1),
    id,
    settings,
    type: "settings",
    updatedAt: args.updatedAt === undefined ? undefined : EpochMillis(args.updatedAt),
  }
}

type EditorStatePatch = Partial<Omit<EditorState, "analysis" | "buffer" | "completion">> & {
  analysis?: Partial<EditorAnalysisState>
  buffer?: EditorBufferPatch
  completion?: Partial<EditorCompletionState>
}

type SqlVisorStatePatch = Partial<Omit<SqlVisorState, "editor" | "settings">> & {
  editor?: EditorStatePatch
  settings?: Partial<SettingsState>
}

export function createSqlVisorState(patch: SqlVisorStatePatch = {}): SqlVisorState {
  const baseEditor = createEmptyEditorState()
  const history = patch.history ?? []
  const hasSelectedQueryExecutionId = Object.hasOwn(patch, "selectedQueryExecutionId")
  const selectedQueryExecutionId = hasSelectedQueryExecutionId
    ? patch.selectedQueryExecutionId ?? null
    : history[0]?.id ?? null
  const selectedQueryExecution = selectedQueryExecutionId
    ? history.find((entry) => entry.id === selectedQueryExecutionId)
    : undefined
  const editor: EditorState = {
    ...baseEditor,
    ...patch.editor,
    analysis: {
      ...baseEditor.analysis,
      ...patch.editor?.analysis,
    },
    buffer: applyEditorBufferPatch(baseEditor.buffer, patch.editor?.buffer ?? {}),
    completion: {
      ...baseEditor.completion,
      ...patch.editor?.completion,
    },
  }
  return {
    sessionId: patch.sessionId ?? "session-1",
    connections: patch.connections ?? pendingQueryState<Connection<any>[]>([]),
    connectionSuggestions: patch.connectionSuggestions ?? pendingQueryState(),
    selectedConnectionId: patch.selectedConnectionId,
    selectedQueryExecutionId,
    editor,
    history,
    savedQueries: patch.savedQueries ?? [],
    settings: {
      ...defaultSettingsState(),
      ...patch.settings,
    },
    queryExecution:
      patch.queryExecution ??
      (selectedQueryExecution
        ? createQueryState({
            data: selectedQueryExecution,
            dataUpdateCount: 1,
            dataUpdatedAt: selectedQueryExecution.finishedAt || selectedQueryExecution.createdAt,
            error: selectedQueryExecution.status === "success" ? null : new Error(selectedQueryExecution.error || ""),
            errorUpdateCount: selectedQueryExecution.status === "success" ? 0 : 1,
            errorUpdatedAt:
              selectedQueryExecution.status === "success"
                ? 0
                : selectedQueryExecution.finishedAt || selectedQueryExecution.createdAt,
            fetchFailureCount: selectedQueryExecution.status === "success" ? 0 : 1,
            fetchFailureReason:
              selectedQueryExecution.status === "success" ? null : new Error(selectedQueryExecution.error || ""),
            fetchStatus: selectedQueryExecution.status === "pending" ? "fetching" : "idle",
            status:
              selectedQueryExecution.status === "pending"
                ? "pending"
                : selectedQueryExecution.status === "success"
                  ? "success"
                  : "error",
          })
        : pendingQueryState<QueryExecution>()),
    objectsByConnectionId: patch.objectsByConnectionId ?? {},
  }
}

type EngineMethodOverrides = {
  addConnection?: (input: AddConnectionInput) => Promise<Connection<any>>
  applyEditorChange?: (change: EditorChange) => void
  applyEditorCompletionItem?: (ref?: EditorCompletionItemRef) => boolean
  cancelEditorAnalysis?: () => void
  cancelQuery?: (query: QueryRef) => void
  cancelRunningQueries?: () => void
  closeEditorCompletion?: () => void
  deleteConnection?: (connectionId: string) => Promise<void>
  formatEditorQuery?: () => boolean
  focusEditorCompletionItem?: (input: EditorCompletionItemFocusInput) => void
  getQueryState?: (query: QueryRef) => QueryState<QueryExecution>
  loadConnectionObjects?: (connectionId: string) => Promise<ObjectInfo[]>
  openEditorCompletion?: (context: EditorCompletionContext) => void
  refreshConnectionSuggestions?: () => Promise<any[]>
  requestEditorAnalysis?: (parentFlowId?: string) => void
  restoreSavedQuery?: (savedQueryId: string) => RestoreSavedQueryResult | undefined
  runQuery?: (input?: RunQueryInput) => QueryRef
  restoreHistoryEntry?: (entryId: string) => void
  restoreQueryExecution?: (entryId: string) => void
  selectQueryExecution?: (queryExecutionId: string | null) => void
  selectConnection?: (connectionId: string | undefined) => void
  saveQueryAsNew?: (input: SaveQueryAsNewInput) => Promise<SavedQuery>
  saveSavedQueryChanges?: (input?: SaveSavedQueryChangesInput) => Promise<SavedQuery>
  replaceSettings?: <Id extends SettingsId>(id: Id, settings: SettingsSchema[Id]) => Promise<SettingsSchema[Id]>
  setEditorBuffer?: (patch: EditorBufferPatch & { savedQueryId?: string | null }) => void
  updateSettings?: <Id extends SettingsId>(id: Id, patch: Partial<SettingsSchema[Id]>) => Promise<SettingsSchema[Id]>
}

export function createEngineStub(
  initialState: SqlVisorStatePatch = {},
  overrides: EngineMethodOverrides = {},
  options: {
    registry?: AdapterRegistry
  } = {},
) {
  const listeners = new Set<() => void>()
  let state = createSqlVisorState(initialState)
  const registry =
    options.registry ?? new AdapterRegistry([new BunSqlAdapter(), new TursoAdapter(), new PostgresAdapter()])
  const queryStates = new Map<string, QueryState<QueryExecution>>()

  const calls: {
    addConnection: AddConnectionInput[]
    applyEditorChange: EditorChange[]
    applyEditorCompletionItem: Array<EditorCompletionItemRef | undefined>
    cancelEditorAnalysis: number
    cancelQuery: QueryRef[]
    cancelRunningQueries: number
    closeEditorCompletion: number
    deleteConnection: string[]
    formatEditorQuery: number
    focusEditorCompletionItem: EditorCompletionItemFocusInput[]
    loadConnectionObjects: string[]
    openEditorCompletion: EditorCompletionContext[]
    refreshConnectionSuggestions: number
    requestEditorAnalysis: Array<string | undefined>
    restoreHistoryEntry: string[]
    restoreQueryExecution: string[]
    restoreSavedQuery: string[]
    runQuery: RunQueryInput[]
    saveQueryAsNew: SaveQueryAsNewInput[]
    saveSavedQueryChanges: Array<SaveSavedQueryChangesInput | undefined>
    replaceSettings: Array<{ id: SettingsId; settings: object }>
    selectQueryExecution: Array<string | null>
    selectConnection: Array<string | undefined>
    setEditorBuffer: Array<EditorBufferPatch & { savedQueryId?: string | null }>
    updateSettings: Array<{ id: SettingsId; patch: object }>
  } = {
    addConnection: [],
    applyEditorChange: [],
    applyEditorCompletionItem: [],
    cancelEditorAnalysis: 0,
    cancelQuery: [],
    cancelRunningQueries: 0,
    closeEditorCompletion: 0,
    deleteConnection: [],
    formatEditorQuery: 0,
    focusEditorCompletionItem: [],
    loadConnectionObjects: [],
    openEditorCompletion: [],
    refreshConnectionSuggestions: 0,
    requestEditorAnalysis: [],
    restoreHistoryEntry: [],
    restoreQueryExecution: [],
    restoreSavedQuery: [],
    runQuery: [],
    saveQueryAsNew: [],
    saveSavedQueryChanges: [],
    replaceSettings: [],
    selectQueryExecution: [],
    selectConnection: [],
    setEditorBuffer: [],
    updateSettings: [],
  }

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setEditorState = (patch: EditorStatePatch) => {
    state = {
      ...state,
      editor: mergeEditorState(state.editor, patch),
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
    async deleteConnection(connectionId: string) {
      calls.deleteConnection.push(connectionId)
      if (overrides.deleteConnection) {
        return overrides.deleteConnection(connectionId)
      }

      const remainingConnections = (state.connections.data ?? []).filter((connection) => connection.id !== connectionId)
      const nextSelectedConnectionId =
        state.selectedConnectionId === connectionId ? remainingConnections[0]?.id : state.selectedConnectionId

      const nextObjectsByConnectionId = { ...state.objectsByConnectionId }
      delete nextObjectsByConnectionId[connectionId]

      state = {
        ...state,
        connections: createQueryState({
          data: remainingConnections,
          dataUpdateCount: state.connections.dataUpdateCount + 1,
          dataUpdatedAt: Date.now(),
          fetchStatus: "idle",
          status: "success",
        }),
        objectsByConnectionId: nextObjectsByConnectionId,
        settings: {
          ...state.settings,
          sidebarState: {
            ...state.settings.sidebarState,
            lastSelectedConnectionId: nextSelectedConnectionId ?? "",
          },
        },
        selectedConnectionId: nextSelectedConnectionId,
      }
      notify()
    },
    runQuery(input: RunQueryInput = {}) {
      calls.runQuery.push(input)
      if (overrides.runQuery) {
        return overrides.runQuery(input)
      }

      const queryRef = {
        queryId: `history-${calls.runQuery.length}`,
      } satisfies QueryRef
      const entry = makeQueryExecution({
        id: queryRef.queryId,
        connectionId: input.connectionId ?? state.selectedConnectionId ?? "conn-1",
        savedQueryId: state.editor.savedQueryId,
        sql: input.text ?? state.editor.buffer.text,
        rows: [],
      })
      const queryState = createQueryState({
        data: entry,
        dataUpdateCount: 1,
        dataUpdatedAt: Date.now(),
        fetchStatus: "idle",
        status: "success",
      })
      queryStates.set(queryRef.queryId, queryState)

      state = {
        ...state,
        history: [entry, ...state.history],
        selectedQueryExecutionId: entry.id,
        queryExecution: queryState,
      }
      notify()
      return queryRef
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
        return
      }

      const entry = state.history.find((candidate) => candidate.id === entryId)
      if (!entry) {
        return
      }

      state = {
        ...state,
        queryExecution: createQueryState({
          data: entry,
          dataUpdateCount: 1,
          dataUpdatedAt: Date.now(),
          error: entry.status === "success" ? null : new Error(entry.error ?? "Query failed."),
          errorUpdateCount: entry.status === "success" ? 0 : 1,
          errorUpdatedAt: entry.status === "success" ? 0 : Date.now(),
          fetchStatus: entry.status === "pending" ? "fetching" : "idle",
          status: entry.status === "pending" ? "pending" : entry.status === "success" ? "success" : "error",
        }),
        selectedQueryExecutionId: entry.id,
      }
      setEditorState({
        analysis: idleEditorAnalysisState(),
        buffer: {
          cursorOffset: entry.sql.source.length,
          text: entry.sql.source,
        },
        completion: closedEditorCompletionState(),
        savedQueryId: entry.savedQueryId ?? undefined,
      })
      notify()
    },
    restoreSavedQuery(savedQueryId: string) {
      calls.restoreSavedQuery.push(savedQueryId)
      if (overrides.restoreSavedQuery) {
        return overrides.restoreSavedQuery(savedQueryId)
      }

      const savedQuery = state.savedQueries.find((entry) => entry.id === savedQueryId)
      if (!savedQuery) {
        return undefined
      }

      const execution = findLatestSavedQueryExecution(savedQuery, state.history, state.connections.data ?? [])
      state = {
        ...state,
        queryExecution: execution
          ? createQueryState({
              data: execution,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: execution.status === "success" ? null : new Error(execution.error ?? "Query failed."),
              errorUpdateCount: execution.status === "success" ? 0 : 1,
              errorUpdatedAt: execution.status === "success" ? 0 : Date.now(),
              fetchStatus: execution.status === "pending" ? "fetching" : "idle",
              status: execution.status === "pending" ? "pending" : execution.status === "success" ? "success" : "error",
            })
          : pendingQueryState(),
        selectedQueryExecutionId: execution?.id ?? null,
      }
      setEditorState({
        analysis: idleEditorAnalysisState(),
        buffer: {
          cursorOffset: savedQuery.text.length,
          text: savedQuery.text,
        },
        completion: closedEditorCompletionState(),
        savedQueryId: savedQuery.id,
      })
      notify()
      return {
        savedQuery,
        queryExecutionId: execution?.id,
      }
    },
    selectQueryExecution(queryExecutionId: string | null) {
      calls.selectQueryExecution.push(queryExecutionId)
      if (overrides.selectQueryExecution) {
        overrides.selectQueryExecution(queryExecutionId)
        return
      }

      const execution = queryExecutionId === null ? undefined : state.history.find((entry) => entry.id === queryExecutionId)
      state = {
        ...state,
        queryExecution: execution
          ? createQueryState({
              data: execution,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: execution.status === "success" ? null : new Error(execution.error ?? "Query failed."),
              errorUpdateCount: execution.status === "success" ? 0 : 1,
              errorUpdatedAt: execution.status === "success" ? 0 : Date.now(),
              fetchStatus: execution.status === "pending" ? "fetching" : "idle",
              status: execution.status === "pending" ? "pending" : execution.status === "success" ? "success" : "error",
            })
          : pendingQueryState(),
        selectedQueryExecutionId: execution?.id ?? null,
      }
      notify()
    },
    getQueryState(query: QueryRef) {
      if (overrides.getQueryState) {
        return overrides.getQueryState(query)
      }
      return queryStates.get(query.queryId) ?? state.queryExecution
    },
    async loadConnectionObjects(connectionId: string) {
      calls.loadConnectionObjects.push(connectionId)
      if (overrides.loadConnectionObjects) {
        return overrides.loadConnectionObjects(connectionId)
      }

      const existing = state.objectsByConnectionId[connectionId]
      const objects = existing?.data ?? []
      state = {
        ...state,
        objectsByConnectionId: {
          ...state.objectsByConnectionId,
          [connectionId]: createQueryState({
            data: objects,
            dataUpdateCount: (existing?.dataUpdateCount ?? 0) + 1,
            dataUpdatedAt: Date.now(),
            fetchStatus: "idle",
            status: "success",
          }),
        },
      }
      notify()
      return objects
    },
    async refreshConnectionSuggestions() {
      calls.refreshConnectionSuggestions += 1
      if (overrides.refreshConnectionSuggestions) {
        return overrides.refreshConnectionSuggestions()
      }

      return state.connectionSuggestions.data ?? []
    },
    cancelQuery(query: QueryRef) {
      calls.cancelQuery.push(query)
      if (overrides.cancelQuery) {
        overrides.cancelQuery(query)
      }
    },
    cancelRunningQueries() {
      calls.cancelRunningQueries += 1
      if (overrides.cancelRunningQueries) {
        overrides.cancelRunningQueries()
      }
    },
    async saveQueryAsNew(input: SaveQueryAsNewInput) {
      calls.saveQueryAsNew.push(input)
      if (overrides.saveQueryAsNew) {
        return overrides.saveQueryAsNew(input)
      }

      const savedQuery = makeSavedQuery({
        createdAt: Date.now(),
        id: `saved-query-${calls.saveQueryAsNew.length}`,
        name: input.name,
        protocol:
          input.protocol ??
          state.connections.data?.find((connection) => connection.id === state.selectedConnectionId)?.protocol,
        text: input.text ?? state.editor.buffer.text,
      })
      state = {
        ...state,
        editor: {
          ...state.editor,
          savedQueryId: savedQuery.id,
        },
        savedQueries: [savedQuery, ...state.savedQueries],
      }
      notify()
      return savedQuery
    },
    async saveSavedQueryChanges(input?: SaveSavedQueryChangesInput) {
      calls.saveSavedQueryChanges.push(input)
      if (overrides.saveSavedQueryChanges) {
        return overrides.saveSavedQueryChanges(input)
      }

      const savedQueryId = state.editor.savedQueryId
      if (!savedQueryId) {
        throw new Error("No saved query loaded.")
      }
      const current = state.savedQueries.find((entry) => entry.id === savedQueryId)
      if (!current) {
        throw new Error("Saved query not found.")
      }

      const savedQuery = {
        ...current,
        name: input?.name ?? current.name,
        protocol:
          input?.protocol ??
          state.connections.data?.find((connection) => connection.id === state.selectedConnectionId)?.protocol ??
          current.protocol,
        text: input?.text ?? state.editor.buffer.text,
        updatedAt: EpochMillis.now(),
      } satisfies SavedQuery
      state = {
        ...state,
        savedQueries: [savedQuery, ...state.savedQueries.filter((entry) => entry.id !== savedQuery.id)],
      }
      notify()
      return savedQuery
    },
    async updateSettings<Id extends SettingsId>(id: Id, patch: Partial<SettingsSchema[Id]>) {
      calls.updateSettings.push({ id, patch: patch as object })
      if (overrides.updateSettings) {
        return overrides.updateSettings(id, patch)
      }

      const settings = {
        ...state.settings[id],
        ...patch,
      } as SettingsSchema[Id]
      state = {
        ...state,
        settings: {
          ...state.settings,
          [id]: settings,
        },
      }
      notify()
      return settings
    },
    async replaceSettings<Id extends SettingsId>(id: Id, settings: SettingsSchema[Id]) {
      calls.replaceSettings.push({ id, settings: settings as object })
      if (overrides.replaceSettings) {
        return overrides.replaceSettings(id, settings)
      }

      state = {
        ...state,
        settings: {
          ...state.settings,
          [id]: settings,
        },
      }
      notify()
      return settings
    },
    cancelEditorAnalysis() {
      calls.cancelEditorAnalysis += 1
      if (overrides.cancelEditorAnalysis) {
        overrides.cancelEditorAnalysis()
        return
      }

      setEditorState({
        analysis: idleEditorAnalysisState(),
      })
      notify()
    },
    cancelActiveQueries() {
      this.cancelRunningQueries()
    },
    selectConnection(connectionId: string | undefined) {
      calls.selectConnection.push(connectionId)
      if (overrides.selectConnection) {
        overrides.selectConnection(connectionId)
        return
      }

      state = {
        ...state,
        settings: {
          ...state.settings,
          sidebarState: {
            ...state.settings.sidebarState,
            lastSelectedConnectionId: connectionId ?? "",
          },
        },
        selectedConnectionId: connectionId,
      }
      notify()
    },
    setEditorBuffer(patch: EditorBufferPatch & { savedQueryId?: string | null }) {
      calls.setEditorBuffer.push(patch)
      if (overrides.setEditorBuffer) {
        overrides.setEditorBuffer(patch)
        return
      }

      setEditorState({
        buffer: patch,
        savedQueryId:
          patch.savedQueryId === undefined ? state.editor.savedQueryId : (patch.savedQueryId ?? undefined),
      })
      notify()
    },
    applyEditorChange(change: EditorChange) {
      calls.applyEditorChange.push(change)
      if (overrides.applyEditorChange) {
        overrides.applyEditorChange(change)
        return
      }

      const completionDecision = decideEditorCompletion({
        change,
        completion: state.editor.completion,
        scopeMode: state.editor.completionScopeMode,
        selectedConnectionId: state.selectedConnectionId,
      })

      if (completionDecision.kind === "open") {
        setEditorState({
          buffer: {
            cursorOffset: change.next.cursorOffset,
            text: change.next.text,
          },
          completion: {
            context: completionDecision.context,
            error: undefined,
            focusedItemId: undefined,
            items: [],
            status: "ready",
          },
        })
      } else if (completionDecision.kind === "close") {
        setEditorState({
          buffer: {
            cursorOffset: change.next.cursorOffset,
            text: change.next.text,
          },
          completion: closedEditorCompletionState(),
        })
      } else {
        setEditorState({
          buffer: {
            cursorOffset: change.next.cursorOffset,
            text: change.next.text,
          },
        })
      }

      notify()
    },
    openEditorCompletion(context: EditorCompletionContext) {
      calls.openEditorCompletion.push(context)
      if (overrides.openEditorCompletion) {
        overrides.openEditorCompletion(context)
        return
      }

      setEditorState({
        completion: {
          context,
          error: undefined,
          focusedItemId: undefined,
          items: [],
          status: "ready",
        },
      })
      notify()
    },
    requestEditorAnalysis(parentFlowId?: string) {
      calls.requestEditorAnalysis.push(parentFlowId)
      if (overrides.requestEditorAnalysis) {
        overrides.requestEditorAnalysis(parentFlowId)
        return
      }

      const subject = createEditorAnalysisSubject(state.editor.buffer, state.selectedConnectionId)
      const result: ExplainResult | undefined = subject.text.trim()
        ? {
            diagnostics: [],
            status: "ok",
          }
        : undefined

      setEditorState({
        analysis: result
          ? {
              result,
              status: "ready",
              subject,
            }
          : idleEditorAnalysisState(),
      })
      notify()
    },
    closeEditorCompletion() {
      calls.closeEditorCompletion += 1
      if (overrides.closeEditorCompletion) {
        overrides.closeEditorCompletion()
        return
      }

      setEditorState({
        completion: closedEditorCompletionState(),
      })
      notify()
    },
    formatEditorQuery() {
      calls.formatEditorQuery += 1
      if (overrides.formatEditorQuery) {
        return overrides.formatEditorQuery()
      }

      if (!state.editor.buffer.text.trim()) {
        return false
      }

      const formattedText = state.editor.buffer.text
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*=\s*/g, " = ")
        .trim()

      if (formattedText === state.editor.buffer.text) {
        return false
      }

      setEditorState({
        buffer: {
          cursorOffset: Math.min(state.editor.buffer.cursorOffset, formattedText.length),
          text: formattedText,
        },
        completion: closedEditorCompletionState(),
      })
      notify()
      return true
    },
    focusEditorCompletionItem(input: EditorCompletionItemFocusInput) {
      calls.focusEditorCompletionItem.push(input)
      if (overrides.focusEditorCompletionItem) {
        overrides.focusEditorCompletionItem(input)
        return
      }

      const completion = state.editor.completion
      if (completion.status === "closed" || completion.items.length === 0) {
        return
      }

      let focusedItemId = completion.focusedItemId ?? completion.items[0]?.id
      if ("id" in input) {
        focusedItemId = completion.items.some((item) => item.id === input.id) ? input.id : focusedItemId
      } else if ("index" in input) {
        focusedItemId = completion.items[clampIndex(input.index, completion.items.length)]?.id
      } else {
        const currentIndex = completion.items.findIndex((item) => item.id === completion.focusedItemId)
        const nextIndex = clampIndex((currentIndex >= 0 ? currentIndex : 0) + input.delta, completion.items.length)
        focusedItemId = completion.items[nextIndex]?.id
      }

      setEditorState({
        completion: {
          ...completion,
          focusedItemId,
        },
      })
      notify()
    },
    applyEditorCompletionItem(ref?: EditorCompletionItemRef) {
      calls.applyEditorCompletionItem.push(ref)
      if (overrides.applyEditorCompletionItem) {
        return overrides.applyEditorCompletionItem(ref)
      }

      const completion = state.editor.completion
      const item =
        (ref ? completion.items.find((candidate) => candidate.id === ref.id) : undefined) ??
        completion.items.find((candidate) => candidate.id === completion.focusedItemId) ??
        completion.items[0]
      if (completion.status === "closed" || !completion.context || !item) {
        return false
      }

      setEditorState({
        buffer: {
          cursorOffset: completion.context.replaceRange.start + item.insertText.length,
          text: replaceTextRange(state.editor.buffer.text, completion.context.replaceRange, item.insertText),
        },
        completion: closedEditorCompletionState(),
        completionScopeMode: item.connectionId ? "selected-connection" : state.editor.completionScopeMode,
      })
      state = {
        ...state,
        selectedConnectionId: item.connectionId ?? state.selectedConnectionId,
      }
      notify()
      return true
    },
    __notify: notify,
    __setState(patch: SqlVisorStatePatch) {
      const nextEditor = patch.editor ? mergeEditorState(state.editor, patch.editor) : state.editor
      const nextSettings = patch.settings
        ? {
            ...state.settings,
            ...patch.settings,
          }
        : state.settings
      state = {
        ...state,
        ...patch,
        editor: nextEditor,
        settings: nextSettings,
      }
      notify()
    },
  } satisfies Pick<
    SqlVisor,
    | "addConnection"
    | "applyEditorChange"
    | "applyEditorCompletionItem"
    | "cancelEditorAnalysis"
    | "cancelQuery"
    | "cancelRunningQueries"
    | "cancelActiveQueries"
    | "closeEditorCompletion"
    | "deleteConnection"
    | "formatEditorQuery"
    | "focusEditorCompletionItem"
    | "getQueryState"
    | "getState"
    | "loadConnectionObjects"
    | "openEditorCompletion"
    | "refreshConnectionSuggestions"
    | "requestEditorAnalysis"
    | "registry"
    | "restoreHistoryEntry"
    | "restoreQueryExecution"
    | "restoreSavedQuery"
    | "runQuery"
    | "replaceSettings"
    | "selectQueryExecution"
    | "selectConnection"
    | "saveQueryAsNew"
    | "saveSavedQueryChanges"
    | "setEditorBuffer"
    | "subscribe"
    | "updateSettings"
  > & {
    __notify: () => void
    __setState: (patch: SqlVisorStatePatch) => void
  }

  return {
    calls,
    engine: engine as unknown as SqlVisor,
    getState: () => state,
    setState: engine.__setState,
  }
}

function mergeEditorState(current: EditorState, patch: EditorStatePatch): EditorState {
  return {
    ...current,
    ...patch,
    analysis: patch.analysis ? { ...current.analysis, ...patch.analysis } : current.analysis,
    buffer: patch.buffer ? applyEditorBufferPatch(current.buffer, patch.buffer) : current.buffer,
    completion: patch.completion ? { ...current.completion, ...patch.completion } : current.completion,
  }
}

function clampIndex(index: number, length: number): number {
  if (length <= 1) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
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
