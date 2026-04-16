import { createCliRenderer, type MouseEvent } from "@opentui/core"
import { createRoot, flushSync, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { focusPath, sameFocusPath } from "../lib/focus/paths"
import { SqlVisor, type DiscoveredConnectionSuggestion } from "../lib/SqlVisor"
import type { Connection } from "../lib/types/Connection"
import type { QueryExecution } from "../lib/types/Log"
import { AddConnectionPane } from "./connection/AddConnectionPane"
import { ResultsTable, RESULTS_TABLE_FOCUS_ID } from "./dataview/ResultsTable"
import { QueryListTable } from "./dataview/table/QueryListTable"
import type { TableColumn } from "./dataview/table/Table"
import { EditorView, QUERY_EDITOR_FOCUS_ID } from "./editor/EditorView"
import { QueryHistory, type QueryFinderEntry } from "./editor/QueryHistory"
import { SaveQueryDialog } from "./editor/SaveQueryDialog"
import { FocusChrome } from "./focus/FocusChrome"
import { Focusable } from "./focus/Focusable"
import { FocusProvider, useFocusedDescendantPath, useFocusTree, useIsFocusNavigationActive, useIsFocusWithin } from "./focus/context"
import { useOpaqueIdMap } from "./focus/opaqueIds"
import { Separator } from "./Separator"
import { SettingsPane } from "./sidebar/SettingsPane"
import { SIDEBAR_AREA_ID, Sidebar } from "./sidebar/Sidebar"
import { SIDEBAR_TREE_AREA_ID } from "./sidebar/TreeView"
import { ConfirmModal } from "./ui/ConfirmModal"
import { KeybindProvider } from "./ui/keybind/KeybindProvider"
import { useNavKeys } from "./ui/keybind/useNavKeys"
import { useShortcut } from "./ui/keybind/useShortcut"
import { Modal } from "./ui/Modal"
import { ModalPresenterProvider, usePresentModal, usePresentedModalCount } from "./ui/presentModal"
import { Text } from "./ui/Text"
import { ThemeProvider, useTheme } from "./ui/theme"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "./useSqlVisor"

type TopRightPane = "editor" | "history"
type DragState = { type: "sidebar" | "editor"; lastPos: number }
type SaveQueryDialogState = {
  error?: string
  initialName: string
  mode: "create" | "fork"
  saving: boolean
}

type RecentQueryTableRowData =
  | {
      kind: "query"
      query: QueryExecution
      connectionName: string
      dimmed: boolean
      now: number
    }
  | {
      kind: "placeholder"
      id: string
    }

const MIN_SIDEBAR_WIDTH = 15
const MIN_PANE_HEIGHT = 3
const EMPTY_RECENT_QUERY_ROW_COUNT = 3

export const RECENT_QUERY_FOCUS_ID = "recent-query-view"
export const RECENT_QUERY_AREA_ID = "recent-query-list"
const RECENT_QUERY_AREA_PATH = [RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID] as const

export function App() {
  return (
    <ModalPresenterProvider>
      <AppBody />
    </ModalPresenterProvider>
  )
}

function AppBody() {
  const engine = useSqlVisor()
  const presentModal = usePresentModal()
  const presentedModalCount = usePresentedModalCount()
  const state = useSqlVisorState()
  const tree = useFocusTree()
  const [pane, setPane] = useState<TopRightPane>("editor")
  const [addConnectionModal, setAddConnectionModal] = useState<
    | {
        initialSuggestion?: DiscoveredConnectionSuggestion
      }
    | undefined
  >()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(30)
  const [editorHeight, setEditorHeight] = useState(12)
  const [showSystemQueries, setShowSystemQueries] = useState(false)
  const [saveDialog, setSaveDialog] = useState<SaveQueryDialogState | undefined>()
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const dragRef = useRef<DragState | null>(null)
  const pendingEditorFocusRef = useRef(false)
  const addConnectionReturnFocusRef = useRef<readonly string[] | undefined>(undefined)
  const settingsReturnFocusRef = useRef<readonly string[] | undefined>(undefined)
  const [dragging, setDragging] = useState<"sidebar" | "editor" | null>(null)
  const connections = state.connections.data ?? []
  const currentSavedQuery = state.editor.savedQueryId
    ? state.savedQueries.find((savedQuery) => savedQuery.id === state.editor.savedQueryId)
    : undefined
  const detailPaneWidth = Math.max(1, termWidth - sidebarWidth - 1)
  const recentQueries = useMemo(
    () => buildRecentQueries(state.history, state.selectedQueryExecutionId, showSystemQueries),
    [showSystemQueries, state.history, state.selectedQueryExecutionId],
  )
  const selectedQueryExecution = state.queryExecution.data

  useEffect(() => {
    if (pane !== "editor" || !pendingEditorFocusRef.current) {
      return
    }

    pendingEditorFocusRef.current = false
    tree.focusPath([QUERY_EDITOR_FOCUS_ID])
  }, [pane, tree])

  useShortcut({
    keys: "ctrl+c",
    enabled: state.history.some((query) => query.status === "pending"),
    onKey: () => engine.cancelRunningQueries(),
  })

  const handleExecute = async (sql: string) => {
    try {
      engine.runQuery({ text: sql })
    } catch {
      // the engine already records error state and history
    }
  }

  const handleRequestEditorAnalysis = useCallback(
    () => {
      engine.requestEditorAnalysis()
    },
    [engine],
  )

  const handleCancelEditorAnalysis = useCallback(() => {
    engine.cancelEditorAnalysis()
  }, [engine])

  const handleRestoreQuery = useCallback(
    (entry: QueryExecution) => {
      engine.restoreQueryExecution(entry.id)
      setPane("editor")
    },
    [engine],
  )

  const handleRestoreQueryFinderEntry = useCallback(
    (entry: QueryFinderEntry) => {
      if (entry.kind === "history") {
        handleRestoreQuery(entry.entry)
        return
      }

      engine.restoreSavedQuery(entry.savedQuery.id)
      setPane("editor")
    },
    [engine, handleRestoreQuery],
  )

  const handleCloseHistory = useCallback(() => {
    pendingEditorFocusRef.current = true
    setPane("editor")
  }, [])

  const handleOpenAddConnection = useCallback((initialSuggestion?: DiscoveredConnectionSuggestion) => {
    const currentPath = tree.getNavigationState().focusedPath
    addConnectionReturnFocusRef.current = currentPath ? [...currentPath] : undefined
    setAddConnectionModal({ initialSuggestion })
  }, [tree])

  const handleCloseAddConnection = useCallback(() => {
    const returnFocus = addConnectionReturnFocusRef.current
    addConnectionReturnFocusRef.current = undefined
    flushSync(() => {
      setAddConnectionModal(undefined)
    })
    if (returnFocus) {
      tree.focusPath(returnFocus)
    }
  }, [tree])

  const handleAddConnectionSaved = useCallback(() => {
    addConnectionReturnFocusRef.current = undefined
    flushSync(() => {
      setPane("editor")
      setAddConnectionModal(undefined)
    })
    tree.focusPath([QUERY_EDITOR_FOCUS_ID])
  }, [tree])

  const handleOpenSettings = useCallback(() => {
    const currentPath = tree.getNavigationState().focusedPath
    settingsReturnFocusRef.current = currentPath ? [...currentPath] : undefined
    setSettingsOpen(true)
  }, [tree])

  const handleCloseSettings = useCallback(() => {
    const returnFocus = settingsReturnFocusRef.current
    settingsReturnFocusRef.current = undefined
    flushSync(() => {
      setSettingsOpen(false)
    })
    if (returnFocus) {
      tree.focusPath(returnFocus)
    }
  }, [tree])

  const handleToggleSettings = useCallback(() => {
    if (settingsOpen) {
      handleCloseSettings()
      return
    }

    handleOpenSettings()
  }, [handleCloseSettings, handleOpenSettings, settingsOpen])

  const handleDeleteConnection = useCallback(
    async (connectionId: string) => {
      const connection = connections.find((candidate) => candidate.id === connectionId)
      if (!connection) {
        return
      }

      const shouldDelete = await presentModal(ConfirmModal, {
        children: `Delete connection "${connection.name}"?`,
        default: "no",
        no: "Cancel",
        yes: "Delete",
      })

      if (!shouldDelete) {
        return
      }

      await engine.deleteConnection(connectionId)
      queueMicrotask(() => {
        const nextSelectedConnectionId = engine.getState().selectedConnectionId
        if (nextSelectedConnectionId) {
          tree.focusPath([SIDEBAR_AREA_ID, SIDEBAR_TREE_AREA_ID])
          return
        }

        tree.focusPath([SIDEBAR_AREA_ID])
      })
    },
    [connections, engine, presentModal, tree],
  )

  const handleOpenSaveDialog = useCallback(() => {
    setSaveDialog({
      error: undefined,
      initialName: currentSavedQuery?.name ?? "",
      mode: currentSavedQuery ? "fork" : "create",
      saving: false,
    })
  }, [currentSavedQuery])

  const handleCloseSaveDialog = useCallback(() => {
    setSaveDialog(undefined)
    queueMicrotask(() => {
      tree.focusPath([QUERY_EDITOR_FOCUS_ID])
    })
  }, [tree])

  const handleSubmitSaveDialog = useCallback(
    async (name: string) => {
      setSaveDialog((current) => (current ? { ...current, error: undefined, saving: true } : current))

      try {
        await engine.saveQueryAsNew({ name })
        setSaveDialog(undefined)
        queueMicrotask(() => {
          tree.focusPath([QUERY_EDITOR_FOCUS_ID])
        })
      } catch (_error) {
        const error = _error instanceof Error ? _error : new Error(String(_error))
        setSaveDialog((current) => (current ? { ...current, error: error.message, saving: false } : current))
      }
    },
    [engine, tree],
  )

  const handleSaveChanges = useCallback(() => {
    void engine.saveSavedQueryChanges().catch((_error) => {
      const error = _error instanceof Error ? _error : new Error(String(_error))
      setSaveDialog({
        error: error.message,
        initialName: currentSavedQuery?.name ?? "",
        mode: "fork",
        saving: false,
      })
    })
  }, [currentSavedQuery?.name, engine])

  const handleActivateRecentQuery = useCallback(
    (query: QueryExecution) => {
      const hasRows = query.status === "success" && query.rows.length > 0
      flushSync(() => {
        engine.selectQueryExecution(query.id)
      })
      if (hasRows) {
        tree.focusPath([RESULTS_TABLE_FOCUS_ID])
      }
    },
    [engine, tree],
  )

  const handleRootDrag = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.type === "sidebar") {
        const delta = e.x - drag.lastPos
        if (delta !== 0) {
          setSidebarWidth((w) => Math.max(MIN_SIDEBAR_WIDTH, Math.min(termWidth - 20, w + delta)))
          drag.lastPos = e.x
        }
      } else {
        const delta = e.y - drag.lastPos
        if (delta !== 0) {
          setEditorHeight((h) => Math.max(MIN_PANE_HEIGHT, Math.min(termHeight - MIN_PANE_HEIGHT - 2, h + delta)))
          drag.lastPos = e.y
        }
      }
    },
    [termWidth, termHeight],
  )

  const handleRootDragEnd = useCallback(() => {
    dragRef.current = null
    setDragging(null)
  }, [])

  const modalStackOpen = !!addConnectionModal || !!saveDialog || settingsOpen || presentedModalCount > 0

  return (
    <box
      flexDirection="row"
      flexGrow={1}
      onMouseDrag={handleRootDrag}
      onMouseDragEnd={handleRootDragEnd}
      onMouseUp={handleRootDragEnd}
      position="relative"
    >
      <box flexDirection="column" flexBasis={sidebarWidth}>
        <Sidebar
          addConnectionEnabled={!modalStackOpen}
          onAddConnection={handleOpenAddConnection}
          onDeleteConnection={handleDeleteConnection}
          onToggleSettings={handleToggleSettings}
          settingsEnabled={settingsOpen || !modalStackOpen}
        />
      </box>

      <Separator
        direction="vertical"
        dragging={dragging === "sidebar"}
        onDragStart={(e) => {
          dragRef.current = { type: "sidebar", lastPos: e.x }
          setDragging("sidebar")
        }}
      />

      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="column" flexBasis={editorHeight}>
          {pane === "editor" && (
            <EditorView
              autoFocus
              editor={state.editor}
              onApplyCompletionItem={() => engine.applyEditorCompletionItem()}
              onCancelAnalysis={handleCancelEditorAnalysis}
              onChange={(change) => engine.applyEditorChange(change)}
              onCloseCompletion={() => engine.closeEditorCompletion()}
              onExecute={handleExecute}
              onFocusCompletionItem={(input) => engine.focusEditorCompletionItem(input)}
              onFormatQuery={() => engine.formatEditorQuery()}
              onHistory={() => setPane("history")}
              onRequestAnalysis={handleRequestEditorAnalysis}
              onSaveAsNew={handleOpenSaveDialog}
              onSaveChanges={currentSavedQuery ? handleSaveChanges : undefined}
              savedQuery={currentSavedQuery}
            />
          )}
          {pane === "history" && (
            <QueryHistory
              connections={connections}
              entries={state.history}
              savedQueries={state.savedQueries}
              showSystemQueries={showSystemQueries}
              onToggleShowSystemQueries={() => setShowSystemQueries((current) => !current)}
              onRestore={handleRestoreQueryFinderEntry}
              onBack={handleCloseHistory}
              width={detailPaneWidth}
            />
          )}
        </box>

        <Separator
          direction="horizontal"
          dragging={dragging === "editor"}
          onDragStart={(e) => {
            dragRef.current = { type: "editor", lastPos: e.y }
            setDragging("editor")
          }}
        />

        <box flexDirection="column" flexGrow={1}>
          <RecentQueryView
            connections={connections}
            onActivate={handleActivateRecentQuery}
            queries={recentQueries}
            selectedQueryId={state.selectedQueryExecutionId}
            width={detailPaneWidth}
          />
          <QueryDetailPanel queryExecution={selectedQueryExecution} width={detailPaneWidth} />
        </box>
      </box>
      {saveDialog && (
        <SaveQueryDialogOverlay
          error={saveDialog.error}
          initialName={saveDialog.initialName}
          mode={saveDialog.mode}
          onCancel={handleCloseSaveDialog}
          onSave={handleSubmitSaveDialog}
          saving={saveDialog.saving}
          termHeight={termHeight}
          termWidth={termWidth}
        />
      )}
      {addConnectionModal && (
        <AddConnectionModal
          initialSuggestion={addConnectionModal.initialSuggestion}
          onClose={handleCloseAddConnection}
          onSaved={handleAddConnectionSaved}
          termHeight={termHeight}
          termWidth={termWidth}
        />
      )}
      {settingsOpen && <SettingsModal onClose={handleCloseSettings} termHeight={termHeight} termWidth={termWidth} />}
      <FocusChrome />
    </box>
  )
}

function AddConnectionModal(props: {
  initialSuggestion?: DiscoveredConnectionSuggestion
  onClose: () => void
  onSaved: () => void
  termHeight: number
  termWidth: number
}) {
  const dialogHeight = Math.max(12, Math.min(24, props.termHeight - 4))

  return (
    <Modal focusNavigable={false} height={dialogHeight} onClose={props.onClose} size="medium" title="Add Connection">
      <AddConnectionPane initialSuggestion={props.initialSuggestion} onSaved={props.onSaved} />
    </Modal>
  )
}

function SaveQueryDialogOverlay(
  props: SaveQueryDialogState & {
    onCancel: () => void
    onSave: (name: string) => void | Promise<void>
    termHeight: number
    termWidth: number
  },
) {
  const dialogWidth = Math.max(32, Math.min(56, props.termWidth - 8))

  return (
    <box
      alignItems="center"
      flexDirection="column"
      height={props.termHeight}
      justifyContent="center"
      left={0}
      position="absolute"
      top={0}
      width={props.termWidth}
      zIndex={10}
    >
      <box width={dialogWidth}>
        <SaveQueryDialog
          error={props.error}
          initialName={props.initialName}
          mode={props.mode}
          onCancel={props.onCancel}
          onSave={props.onSave}
          saving={props.saving}
        />
      </box>
    </box>
  )
}

function SettingsModal(props: {
  onClose: () => void
  termHeight: number
  termWidth: number
}) {
  const dialogWidth = Math.max(36, Math.min(56, props.termWidth - 8))
  const dialogHeight = Math.max(10, Math.min(16, props.termHeight - 6))

  return (
    <Modal focusNavigable={false} height={dialogHeight} onClose={props.onClose} title="Settings" width={dialogWidth}>
      <SettingsPane />
    </Modal>
  )
}

function RecentQueryView(props: {
  queries: QueryExecution[]
  connections: Connection<any>[]
  selectedQueryId: string | null
  onActivate: (query: QueryExecution) => void
  width?: number
}) {
  return (
    <Focusable
      childrenNavigable={false}
      delegatesFocus
      focusSelf
      focusable
      flexDirection="column"
      focusableId={RECENT_QUERY_FOCUS_ID}
      position="relative"
    >
      <RecentQueryViewBody {...props} />
    </Focusable>
  )
}

function RecentQueryViewBody(props: {
  queries: QueryExecution[]
  connections: Connection<any>[]
  selectedQueryId: string | null
  onActivate: (query: QueryExecution) => void
  width?: number
}) {
  const { queries, connections, onActivate, selectedQueryId, width } = props
  const tree = useFocusTree()
  const theme = useTheme()
  const focusedWithin = useIsFocusWithin([RECENT_QUERY_FOCUS_ID])
  const navigationActive = useIsFocusNavigationActive()
  const focusedDescendantPath = useFocusedDescendantPath()
  const [now, setNow] = useState(Date.now)
  const queryIds = useMemo(() => queries.map((query) => query.id), [queries])
  const queryFocusIds = useOpaqueIdMap(queryIds, "query")
  const queryPaths = useMemo(() => {
    const next = new Map<string, readonly string[]>()
    for (const queryId of queryIds) {
      const focusableId = queryFocusIds.get(queryId)
      if (focusableId) {
        next.set(queryId, focusPath(RECENT_QUERY_AREA_PATH, focusableId))
      }
    }
    return next
  }, [queryFocusIds, queryIds])

  useEffect(() => {
    if (!queries.some((query) => query.status === "pending")) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [queries])

  const focusedQueryId = resolveFocusedRecentQueryId(focusedDescendantPath, queryPaths)
  const currentQueryId = focusedQueryId ?? selectedQueryId ?? queries[0]?.id
  const selectedIndex = queries.findIndex((query) => query.id === currentQueryId)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
  const currentQuery = queries[currentIndex]
  const displayRows = useMemo<RecentQueryTableRowData[]>(
    () =>
      queries.length === 0
        ? Array.from({ length: EMPTY_RECENT_QUERY_ROW_COUNT }, (_, index) => ({
            kind: "placeholder",
            id: `empty-${index}`,
          }))
        : queries.map((query) => ({
            kind: "query",
            query,
            connectionName: connections.find((connection) => connection.id === query.connectionId)?.name ?? "",
            dimmed: query.initiator === "system",
            now,
          })),
    [connections, now, queries],
  )
  const columns = useMemo<Record<string, TableColumn<RecentQueryTableRowData>>>(
    () => ({
      status: {
        width: { absolute: 2 },
        Cell: ({ row }) => (
          <Text
            fg={
              row.kind === "query" ? (row.dimmed ? theme.mutedFg : recentQueryStatusColor(row.query, theme)) : undefined
            }
            wrapMode="none"
            truncate
          >
            {row.kind === "query" ? recentQueryStatusGlyph(row.query) : ""}
          </Text>
        ),
      },
      started: {
        width: { absolute: 12 },
        Cell: ({ row }) => (
          <Text fg={row.kind === "query" && row.dimmed ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? formatTime(row.query.createdAt) : ""}
          </Text>
        ),
      },
      query: {
        width: { grow: 4 },
        Cell: ({ row }) => (
          <Text fg={row.kind === "query" && row.dimmed ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? truncateSql(row.query.sql.source, 120) : ""}
          </Text>
        ),
      },
      elapsed: {
        width: { absolute: 8 },
        Cell: ({ row }) => (
          <Text fg={row.kind === "query" ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? formatRecentQueryElapsed(row.query, row.now) : ""}
          </Text>
        ),
      },
      connection: {
        width: { grow: 2 },
        Cell: ({ row }) => (
          <Text fg={row.kind === "query" ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? row.connectionName : ""}
          </Text>
        ),
      },
    }),
    [theme],
  )

  useEffect(() => {
    if (queries.length === 0 || focusedDescendantPath || !focusedWithin) {
      return
    }

    const query =
      queries.find((candidate) => candidate.id === (selectedQueryId ?? currentQuery?.id)) ?? currentQuery
    if (!query) {
      return
    }
    queueMicrotask(() => {
      const queryPath = queryPaths.get(query.id)
      if (queryPath) {
        tree.focusPath(queryPath)
      }
    })
  }, [currentQuery, focusedDescendantPath, focusedWithin, queries, queryPaths, selectedQueryId, tree])

  function focusRow(nextIndex: number) {
    const query = queries[nextIndex]
    const queryPath = query ? queryPaths.get(query.id) : undefined
    if (!queryPath) {
      return
    }
    tree.focusPath(queryPath)
  }

  useNavKeys({
    enabled: !navigationActive && focusedWithin && queries.length > 0,
    handlers: {
      down(key) {
        key.preventDefault()
        key.stopPropagation()
        focusRow(Math.min(queries.length - 1, currentIndex + 1))
      },
      up(key) {
        key.preventDefault()
        key.stopPropagation()
        focusRow(Math.max(0, currentIndex - 1))
      },
    },
  })

  useShortcut({
    enabled: !navigationActive && focusedWithin && queries.length > 0 && !!currentQuery,
    keys: { or: ["enter", "return"] },
    onKey(key) {
      key.preventDefault()
      key.stopPropagation()
      if (currentQuery) {
        onActivate(currentQuery)
      }
    },
  })

  return (
    <box flexDirection="column" position="relative">
      <Focusable focusableId={RECENT_QUERY_AREA_ID}>
        <QueryListTable
          rows={displayRows}
          columns={columns}
          width={width}
          getRowKey={(row) => (row.kind === "query" ? row.query.id : row.id)}
          getRowFocusableId={(row) => (row.kind === "query" ? queryFocusIds.get(row.query.id) : undefined)}
          isRowDimmed={(row) => (row.kind === "query" ? row.dimmed : false)}
          isRowFocused={(row) => (row.kind === "query" ? sameFocusPath(queryPaths.get(row.query.id), focusedDescendantPath) : false)}
          isRowSelected={(row) => (row.kind === "query" ? row.query.id === selectedQueryId : false)}
        />
      </Focusable>
    </box>
  )
}

function QueryDetailPanel(props: { queryExecution: QueryExecution | undefined; width?: number }) {
  return <QueryDetailSurface queryExecution={props.queryExecution} width={props.width} />
}

function QueryDetailSurface(props: { queryExecution: QueryExecution | undefined; width?: number }) {
  const { queryExecution, width } = props
  const theme = useTheme()

  if (queryExecution) {
    return renderSelectedQueryDetail(queryExecution, theme, width)
  }

  return renderCenteredState(theme, "No query run selected")
}

function renderSelectedQueryDetail(query: QueryExecution, theme: ReturnType<typeof useTheme>, width?: number) {
  switch (query.status) {
    case "success":
      if (query.rows.length === 0) {
        return renderCenteredState(theme, "No rows returned")
      }
      return (
        <box flexDirection="column" flexGrow={1}>
          <QueryDetailLabelRow label={formatResultDividerLabel(query.rows.length)} />
          <ResultsTable rows={query.rows} width={width} />
        </box>
      )
    case "pending":
      return renderCenteredState(theme, "Query running", "Results will appear here when it completes.")
    case "cancelled":
      return renderCenteredState(theme, "Query cancelled", query.error ?? "Execution was cancelled.")
    case "error":
      return renderCenteredState(theme, "Query failed", query.error ?? "Query failed.")
  }
}

function renderCenteredState(theme: ReturnType<typeof useTheme>, title: string, message?: string) {
  return (
    <box
      alignItems="center"
      flexDirection="column"
      flexGrow={1}
      justifyContent="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text fg={theme.mutedFg}>{title}</Text>
      {message && (
        <Text fg={theme.mutedFg} wrapMode="word">
          {message}
        </Text>
      )}
    </box>
  )
}

function QueryDetailLabelRow(props: { label: string }) {
  const theme = useTheme()
  return (
    <box alignItems="center" flexDirection="row" flexShrink={0}>
      <box flexGrow={1} />
      <Text fg={theme.mutedFg} wrapMode="none">
        {props.label}
      </Text>
    </box>
  )
}

function buildRecentQueries(
  history: QueryExecution[],
  selectedQueryId: string | null,
  showSystemQueries = false,
): QueryExecution[] {
  const visibleHistory = history.filter((execution) => showSystemQueries || execution.initiator === "user")
  const runningQueries = visibleHistory.filter((execution) => execution.status === "pending")
  const finishedQueries = visibleHistory.filter((execution) => execution.status !== "pending")
  const visibleFinishedQueries = finishedQueries.slice(0, 2)
  const selectedFinishedQuery = selectedQueryId
    ? finishedQueries.find(
        (query) =>
          query.id === selectedQueryId &&
          !visibleFinishedQueries.some((candidate) => candidate.id === selectedQueryId),
      )
    : undefined
  if (selectedFinishedQuery) {
    if (visibleFinishedQueries.length < 2) {
      visibleFinishedQueries.push(selectedFinishedQuery)
    } else {
      visibleFinishedQueries[visibleFinishedQueries.length - 1] = selectedFinishedQuery
    }
  }

  return [...runningQueries, ...visibleFinishedQueries]
}

function recentQueryStatusGlyph(query: QueryExecution): string {
  switch (query.status) {
    case "pending":
      return "…"
    case "success":
      return "✓"
    case "error":
      return "×"
    case "cancelled":
      return "-"
  }
}

function recentQueryStatusColor(query: QueryExecution, theme: ReturnType<typeof useTheme>): string {
  switch (query.status) {
    case "pending":
      return theme.warningFg
    case "success":
      return theme.successFg
    case "error":
      return theme.errorFg
    case "cancelled":
      return theme.mutedFg
  }
}

function resolveFocusedRecentQueryId(
  path: readonly string[] | undefined,
  queryPaths: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  for (const [queryId, queryPath] of queryPaths) {
    if (sameFocusPath(queryPath, path)) {
      return queryId
    }
  }
  return undefined
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

function formatRecentQueryElapsed(query: QueryExecution, now: number): string {
  const endTime = query.finishedAt ?? now
  return formatElapsed(Math.max(0, endTime - query.createdAt))
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function formatResultDividerLabel(rowCount: number): string {
  return rowCount === 1 ? "1 row" : `${rowCount} rows`
}

function truncateSql(sql: string, max: number): string {
  const oneLine = sql.replace(/\s+/g, " ").trim()
  if (oneLine.length <= max) return oneLine
  return oneLine.slice(0, max) + "…"
}

if (import.meta.main) {
  const engine = await SqlVisor.create()
  const renderer = await createCliRenderer()
  createRoot(renderer).render(
    <FocusProvider>
      <KeybindProvider>
        <ThemeProvider>
          <SqlVisorProvider engine={engine}>
            <App />
          </SqlVisorProvider>
        </ThemeProvider>
      </KeybindProvider>
    </FocusProvider>,
  )
}
