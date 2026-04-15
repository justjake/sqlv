import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BunSqlAdapter, type BunSqlConfig } from "../src/lib/adapters/BunSqlAdapter"
import { PostgresAdapter } from "../src/lib/adapters/postgres"
import { TursoAdapter } from "../src/lib/adapters/TursoAdapter"
import { createSession } from "../src/lib/createLocalPersistence"
import { createNoopLogStore } from "../src/lib/createNoopLogStore"
import { AdapterRegistry, type Protocol } from "../src/lib/interface/Adapter"
import { QueryRunnerImpl } from "../src/lib/QueryRunnerImpl"
import {
  type AddConnectionInput,
  type RequestEditorAnalysisInput,
  type EditorState,
  type EditorSuggestionMenuItemFocusInput,
  type EditorSuggestionMenuItemRef,
  type OpenEditorSuggestionMenuInput,
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

type SqlVisorStatePatch = Partial<Omit<SqlVisorState, "editor" | "settings">> & {
  editor?: Partial<EditorState>
  settings?: Partial<SettingsState>
}

export function createSqlVisorState(patch: SqlVisorStatePatch = {}): SqlVisorState {
  const editor: EditorState = {
    analysis: {
      status: "idle",
      ...patch.editor?.analysis,
    },
    cursorOffset: 0,
    savedQueryId: patch.editor?.savedQueryId,
    suggestionMenu: {
      items: [],
      open: false,
      query: "",
      status: "closed",
      ...patch.editor?.suggestionMenu,
    },
    suggestionScopeMode: "all-connections",
    text: "",
    ...patch.editor,
  }
  const emptyDetailView: SqlVisorState["detailView"] = {
    kind: "empty",
    title: "Results",
    message: "Run a query to inspect results.",
  }

  return {
    sessionId: patch.sessionId ?? "session-1",
    connections: patch.connections ?? pendingQueryState<Connection<any>[]>([]),
    connectionSuggestions: patch.connectionSuggestions ?? pendingQueryState(),
    selectedConnectionId: patch.selectedConnectionId,
    editor,
    history: patch.history ?? [],
    savedQueries: patch.savedQueries ?? [],
    settings: {
      ...defaultSettingsState(),
      ...patch.settings,
    },
    detailView: patch.detailView ?? emptyDetailView,
    queryExecution: patch.queryExecution ?? pendingQueryState<QueryExecution>(),
    activeQueries: patch.activeQueries ?? [],
    objectsByConnectionId: patch.objectsByConnectionId ?? {},
  }
}

type EngineMethodOverrides = {
  addConnection?: (input: AddConnectionInput) => Promise<Connection<any>>
  applyEditorSuggestionMenuItem?: (ref?: EditorSuggestionMenuItemRef) => boolean
  cancelEditorAnalysis?: () => void
  cancelQuery?: (query: QueryRef) => void
  cancelRunningQueries?: () => void
  closeEditorSuggestionMenu?: () => void
  deleteConnection?: (connectionId: string) => Promise<void>
  formatEditorQuery?: () => boolean
  focusEditorSuggestionMenuItem?: (input: EditorSuggestionMenuItemFocusInput) => void
  getQueryState?: (query: QueryRef) => QueryState<QueryExecution>
  loadConnectionObjects?: (connectionId: string) => Promise<ObjectInfo[]>
  openEditorSuggestionMenu?: (input: OpenEditorSuggestionMenuInput) => void
  refreshConnectionSuggestions?: () => Promise<any[]>
  requestEditorAnalysis?: (input?: RequestEditorAnalysisInput) => void
  restoreSavedQuery?: (savedQueryId: string) => RestoreSavedQueryResult | undefined
  runQuery?: (input?: RunQueryInput) => QueryRef
  restoreHistoryEntry?: (entryId: string) => void
  restoreQueryExecution?: (entryId: string) => void
  selectConnection?: (connectionId: string | undefined) => void
  saveQueryAsNew?: (input: SaveQueryAsNewInput) => Promise<SavedQuery>
  saveSavedQueryChanges?: (input?: SaveSavedQueryChangesInput) => Promise<SavedQuery>
  replaceSettings?: <Id extends SettingsId>(id: Id, settings: SettingsSchema[Id]) => Promise<SettingsSchema[Id]>
  setEditorState?: (
    patch: Partial<Pick<EditorState, "text" | "cursorOffset">> & { savedQueryId?: string | null },
  ) => void
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
    applyEditorSuggestionMenuItem: Array<EditorSuggestionMenuItemRef | undefined>
    cancelEditorAnalysis: number
    cancelQuery: QueryRef[]
    cancelRunningQueries: number
    closeEditorSuggestionMenu: number
    deleteConnection: string[]
    formatEditorQuery: number
    focusEditorSuggestionMenuItem: EditorSuggestionMenuItemFocusInput[]
    loadConnectionObjects: string[]
    openEditorSuggestionMenu: OpenEditorSuggestionMenuInput[]
    refreshConnectionSuggestions: number
    requestEditorAnalysis: Array<RequestEditorAnalysisInput | undefined>
    restoreHistoryEntry: string[]
    restoreQueryExecution: string[]
    restoreSavedQuery: string[]
    runQuery: RunQueryInput[]
    saveQueryAsNew: SaveQueryAsNewInput[]
    saveSavedQueryChanges: Array<SaveSavedQueryChangesInput | undefined>
    replaceSettings: Array<{ id: SettingsId; settings: object }>
    selectConnection: Array<string | undefined>
    setEditorState: Array<Partial<Pick<EditorState, "text" | "cursorOffset">> & { savedQueryId?: string | null }>
    updateSettings: Array<{ id: SettingsId; patch: object }>
  } = {
    addConnection: [],
    applyEditorSuggestionMenuItem: [],
    cancelEditorAnalysis: 0,
    cancelQuery: [],
    cancelRunningQueries: 0,
    closeEditorSuggestionMenu: 0,
    deleteConnection: [],
    formatEditorQuery: 0,
    focusEditorSuggestionMenuItem: [],
    loadConnectionObjects: [],
    openEditorSuggestionMenu: [],
    refreshConnectionSuggestions: 0,
    requestEditorAnalysis: [],
    restoreHistoryEntry: [],
    restoreQueryExecution: [],
    restoreSavedQuery: [],
    runQuery: [],
    saveQueryAsNew: [],
    saveSavedQueryChanges: [],
    replaceSettings: [],
    selectConnection: [],
    setEditorState: [],
    updateSettings: [],
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
        sql: input.text ?? state.editor.text,
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
        detailView:
          entry.status === "success"
            ? {
                kind: "rows",
                rows: entry.rows,
                title: `Results (${entry.rows.length})`,
              }
            : {
                kind: "error",
                message: entry.error ?? "Query failed.",
                title: entry.status === "cancelled" ? "Query Cancelled" : "Query Error",
              },
        editor: {
          ...state.editor,
          cursorOffset: entry.sql.source.length,
          savedQueryId: entry.savedQueryId,
          text: entry.sql.source,
        },
      }
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

      const execution = state.history.find(
        (entry) => entry.savedQueryId === savedQuery.id || entry.sql.source === savedQuery.text,
      )
      state = {
        ...state,
        detailView:
          execution?.status === "success"
            ? {
                kind: "rows",
                rows: execution.rows,
                title: `Results (${execution.rows.length})`,
              }
            : execution
              ? {
                  kind: "error",
                  message: execution.error ?? "Query failed.",
                  title: execution.status === "cancelled" ? "Query Cancelled" : "Query Error",
                }
              : {
                  kind: "empty",
                  message: "No query run selected",
                  title: "Results",
                },
        editor: {
          ...state.editor,
          cursorOffset: savedQuery.text.length,
          savedQueryId: savedQuery.id,
          text: savedQuery.text,
        },
      }
      notify()
      return {
        savedQuery,
        queryExecutionId: execution?.id,
      }
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
        text: input.text ?? state.editor.text,
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
        text: input?.text ?? state.editor.text,
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

      state = {
        ...state,
        editor: {
          ...state.editor,
          analysis: {
            status: "idle",
          },
        },
      }
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
    setEditorState(patch: Partial<Pick<EditorState, "text" | "cursorOffset">> & { savedQueryId?: string | null }) {
      calls.setEditorState.push(patch)
      if (overrides.setEditorState) {
        overrides.setEditorState(patch)
        return
      }

      const nextText = patch.text ?? state.editor.text
      const nextCursorOffset = patch.cursorOffset ?? state.editor.cursorOffset
      state = {
        ...state,
        editor: {
          ...state.editor,
          cursorOffset: nextCursorOffset,
          savedQueryId:
            patch.savedQueryId === undefined ? state.editor.savedQueryId : (patch.savedQueryId ?? undefined),
          text: nextText,
        },
      }
      notify()
    },
    openEditorSuggestionMenu(input: OpenEditorSuggestionMenuInput) {
      calls.openEditorSuggestionMenu.push(input)
      if (overrides.openEditorSuggestionMenu) {
        overrides.openEditorSuggestionMenu(input)
        return
      }

      state = {
        ...state,
        editor: {
          ...state.editor,
          cursorOffset: input.cursorOffset,
          text: input.documentText,
          suggestionMenu: {
            error: undefined,
            focusedItemId: undefined,
            items: [],
            open: true,
            query: input.trigger.query ?? "",
            replacementRange: input.replacementRange,
            scope: input.scope,
            status: "ready",
            trigger: input.trigger,
          },
        },
      }
      notify()
    },
    requestEditorAnalysis(input?: RequestEditorAnalysisInput) {
      calls.requestEditorAnalysis.push(input)
      if (overrides.requestEditorAnalysis) {
        overrides.requestEditorAnalysis(input)
        return
      }

      const nextText = input?.text ?? state.editor.text
      const connectionId = input?.connectionId ?? state.selectedConnectionId
      const result: ExplainResult | undefined = nextText.trim()
        ? {
            diagnostics: [],
            status: "ok",
          }
        : undefined

      state = {
        ...state,
        editor: {
          ...state.editor,
          analysis: result
            ? {
                connectionId,
                requestedText: nextText,
                result,
                status: "ready",
              }
            : {
                status: "idle",
              },
        },
      }
      notify()
    },
    closeEditorSuggestionMenu() {
      calls.closeEditorSuggestionMenu += 1
      if (overrides.closeEditorSuggestionMenu) {
        overrides.closeEditorSuggestionMenu()
        return
      }

      state = {
        ...state,
        editor: {
          ...state.editor,
          suggestionMenu: {
            items: [],
            open: false,
            query: "",
            status: "closed",
          },
        },
      }
      notify()
    },
    formatEditorQuery() {
      calls.formatEditorQuery += 1
      if (overrides.formatEditorQuery) {
        return overrides.formatEditorQuery()
      }

      if (!state.editor.text.trim()) {
        return false
      }

      const formattedText = state.editor.text
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*=\s*/g, " = ")
        .trim()

      if (formattedText === state.editor.text) {
        return false
      }

      state = {
        ...state,
        editor: {
          ...state.editor,
          cursorOffset: Math.min(state.editor.cursorOffset, formattedText.length),
          suggestionMenu: {
            items: [],
            open: false,
            query: "",
            status: "closed",
          },
          text: formattedText,
        },
      }
      notify()
      return true
    },
    focusEditorSuggestionMenuItem(input: EditorSuggestionMenuItemFocusInput) {
      calls.focusEditorSuggestionMenuItem.push(input)
      if (overrides.focusEditorSuggestionMenuItem) {
        overrides.focusEditorSuggestionMenuItem(input)
        return
      }

      const menu = state.editor.suggestionMenu
      if (!menu.open || menu.items.length === 0) {
        return
      }

      let focusedItemId = menu.focusedItemId ?? menu.items[0]?.id
      if ("id" in input) {
        focusedItemId = menu.items.some((item) => item.id === input.id) ? input.id : focusedItemId
      } else if ("index" in input) {
        focusedItemId = menu.items[clampIndex(input.index, menu.items.length)]?.id
      } else {
        const currentIndex = menu.items.findIndex((item) => item.id === menu.focusedItemId)
        const nextIndex = clampIndex((currentIndex >= 0 ? currentIndex : 0) + input.delta, menu.items.length)
        focusedItemId = menu.items[nextIndex]?.id
      }

      state = {
        ...state,
        editor: {
          ...state.editor,
          suggestionMenu: {
            ...menu,
            focusedItemId,
          },
        },
      }
      notify()
    },
    applyEditorSuggestionMenuItem(ref?: EditorSuggestionMenuItemRef) {
      calls.applyEditorSuggestionMenuItem.push(ref)
      if (overrides.applyEditorSuggestionMenuItem) {
        return overrides.applyEditorSuggestionMenuItem(ref)
      }

      const menu = state.editor.suggestionMenu
      const item =
        (ref ? menu.items.find((candidate) => candidate.id === ref.id) : undefined) ??
        menu.items.find((candidate) => candidate.id === menu.focusedItemId) ??
        menu.items[0]
      if (!menu.open || !menu.replacementRange || !item) {
        return false
      }

      state = {
        ...state,
        editor: {
          ...state.editor,
          cursorOffset: menu.replacementRange.start + item.insertText.length,
          suggestionMenu: {
            items: [],
            open: false,
            query: "",
            status: "closed",
          },
          suggestionScopeMode: item.connectionId ? "selected-connection" : state.editor.suggestionScopeMode,
          text: replaceTextRange(
            state.editor.text,
            menu.replacementRange.start,
            menu.replacementRange.end,
            item.insertText,
          ),
        },
        selectedConnectionId: item.connectionId ?? state.selectedConnectionId,
      }
      notify()
      return true
    },
    __notify: notify,
    __setState(patch: SqlVisorStatePatch) {
      const nextEditor = patch.editor
        ? {
            ...state.editor,
            ...patch.editor,
          }
        : state.editor
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
    | "applyEditorSuggestionMenuItem"
    | "cancelEditorAnalysis"
    | "cancelQuery"
    | "cancelRunningQueries"
    | "cancelActiveQueries"
    | "closeEditorSuggestionMenu"
    | "deleteConnection"
    | "formatEditorQuery"
    | "focusEditorSuggestionMenuItem"
    | "getQueryState"
    | "getState"
    | "loadConnectionObjects"
    | "openEditorSuggestionMenu"
    | "refreshConnectionSuggestions"
    | "requestEditorAnalysis"
    | "registry"
    | "restoreHistoryEntry"
    | "restoreQueryExecution"
    | "restoreSavedQuery"
    | "runQuery"
    | "replaceSettings"
    | "selectConnection"
    | "saveQueryAsNew"
    | "saveSavedQueryChanges"
    | "setEditorState"
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

function replaceTextRange(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end)
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
