import { createCliRenderer, type MouseEvent } from "@opentui/core"
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { sameFocusPath } from "../lib/focus"
import { SqlVisor, type ActiveQuery, type DetailView, type QueryExecution } from "../index"
import type { Connection } from "../lib/types/Connection"
import { AddConnectionPane } from "./connection/AddConnectionPane"
import { ResultsTable, RESULTS_TABLE_FOCUS_ID } from "./dataview/ResultsTable"
import { QueryListTable, type TableColumn } from "./dataview/table"
import { EditorView, QUERY_EDITOR_FOCUS_ID } from "./editor/EditorView"
import { QueryHistory, type QueryFinderEntry } from "./editor/QueryHistory"
import { SaveQueryDialog } from "./editor/SaveQueryDialog"
import {
  FocusHalo,
  Focusable,
  FocusNavigationHint,
  FocusProvider,
  useFocusedDescendantPath,
  useFocusTree,
  useIsFocusNavigationActive,
  useIsFocusWithin,
} from "./focus"
import { Separator } from "./Separator"
import { Sidebar } from "./sidebar/Sidebar"
import { KeybindProvider, useKeybind, useShortcut } from "./ui/keybind"
import { ThemeProvider, useTheme } from "./ui/theme"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "./useSqlVisor"

type TopRightPane = "editor" | "history" | "add-connection"
type DragState = { type: "sidebar" | "editor"; lastPos: number }
type SaveQueryDialogState = {
  error?: string
  initialName: string
  mode: "create" | "fork"
  saving: boolean
}

type RecentQuery = {
  queryId: string
  text: string
  connectionId: string
  startedAt: number
  initiator: QueryExecution["initiator"]
  status: QueryExecution["status"]
  isActive: boolean
  execution?: QueryExecution
}

type RecentQueryTableRowData =
  | {
      kind: "query"
      query: RecentQuery
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
export const QUERY_INSPECTOR_FOCUS_ID = "query-inspector"

export function App() {
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const tree = useFocusTree()
  const [pane, setPane] = useState<TopRightPane>("editor")
  const [sidebarWidth, setSidebarWidth] = useState(30)
  const [editorHeight, setEditorHeight] = useState(12)
  const [selectedRecentQueryId, setSelectedRecentQueryId] = useState<string | null | undefined>()
  const [showSystemQueries, setShowSystemQueries] = useState(false)
  const [saveDialog, setSaveDialog] = useState<SaveQueryDialogState | undefined>()
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState<"sidebar" | "editor" | null>(null)
  const connections = state.connections.data ?? []
  const currentSavedQuery = state.editor.savedQueryId
    ? state.savedQueries.find((savedQuery) => savedQuery.id === state.editor.savedQueryId)
    : undefined
  const detailPaneWidth = Math.max(1, termWidth - sidebarWidth - 1)
  const recentQueries = useMemo(
    () => buildRecentQueries(engine, state.activeQueries, state.history, selectedRecentQueryId ?? undefined, showSystemQueries),
    [engine, selectedRecentQueryId, showSystemQueries, state.activeQueries, state.history],
  )
  const selectedRecentQuery =
    selectedRecentQueryId === null
      ? undefined
      : recentQueries.find((query) => query.queryId === selectedRecentQueryId) ??
        (selectedRecentQueryId === undefined ? recentQueries[0] : undefined)

  useEffect(() => {
    setSelectedRecentQueryId((current) => {
      if (current === null || current === undefined) {
        return current
      }
      if (recentQueries.some((query) => query.queryId === current)) {
        return current
      }
      return undefined
    })
  }, [recentQueries])

  useShortcut({
    keys: "ctrl+c",
    enabled: state.activeQueries.length > 0,
    onKey: () => engine.cancelRunningQueries(),
  })

  const handleExecute = async (sql: string) => {
    try {
      const query = engine.runQuery({ text: sql })
      setSelectedRecentQueryId(query.queryId)
    } catch {
      // the engine already records error state and history
    }
  }

  const handleRequestEditorAnalysis = useCallback(
    (input?: Parameters<SqlVisor["requestEditorAnalysis"]>[0]) => {
      engine.requestEditorAnalysis(input)
    },
    [engine],
  )

  const handleCancelEditorAnalysis = useCallback(() => {
    engine.cancelEditorAnalysis()
  }, [engine])

  const handleRestoreQuery = useCallback((entry: QueryExecution) => {
    setSelectedRecentQueryId(entry.id)
    engine.restoreQueryExecution(entry.id)
    setPane("editor")
  }, [engine])

  const handleRestoreQueryFinderEntry = useCallback((entry: QueryFinderEntry) => {
    if (entry.kind === "history") {
      handleRestoreQuery(entry.entry)
      return
    }

    const restored = engine.restoreSavedQuery(entry.savedQuery.id)
    setSelectedRecentQueryId(restored?.queryExecutionId ?? null)
    setPane("editor")
  }, [engine, handleRestoreQuery])

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

  const handleSubmitSaveDialog = useCallback(async (name: string) => {
    setSaveDialog((current) => current ? { ...current, error: undefined, saving: true } : current)

    try {
      await engine.saveQueryAsNew({ name })
      setSaveDialog(undefined)
      queueMicrotask(() => {
        tree.focusPath([QUERY_EDITOR_FOCUS_ID])
      })
    } catch (_error) {
      const error = _error instanceof Error ? _error : new Error(String(_error))
      setSaveDialog((current) => current ? { ...current, error: error.message, saving: false } : current)
    }
  }, [engine, tree])

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
    (query: RecentQuery) => {
      setSelectedRecentQueryId(query.queryId)
      if (query.status === "success" && (query.execution?.rows.length ?? 0) > 0) {
        tree.focusPath([QUERY_INSPECTOR_FOCUS_ID, RESULTS_TABLE_FOCUS_ID])
        return
      }
      tree.focusPath([QUERY_INSPECTOR_FOCUS_ID])
    },
    [tree],
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
        <Sidebar onAddConnection={() => setPane("add-connection")} />
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
              analysisConnectionId={state.selectedConnectionId}
              autoFocus
              editor={state.editor}
              onAddConnection={() => setPane("add-connection")}
              onApplySuggestionMenuItem={() => engine.applyEditorSuggestionMenuItem()}
              onCancelAnalysis={handleCancelEditorAnalysis}
              onCloseSuggestionMenu={() => engine.closeEditorSuggestionMenu()}
              onEditorChange={(patch) => engine.setEditorState(patch)}
              onExecute={handleExecute}
              onFocusSuggestionMenuItem={(input) => engine.focusEditorSuggestionMenuItem(input)}
              onHistory={() => setPane("history")}
              onOpenSuggestionMenu={(input) => engine.openEditorSuggestionMenu(input)}
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
              onBack={() => setPane("editor")}
              width={detailPaneWidth}
            />
          )}
          {pane === "add-connection" && (
            <AddConnectionPane onBack={() => setPane("editor")} onSaved={() => setPane("editor")} />
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
            selectedQueryId={selectedRecentQuery?.queryId}
            width={detailPaneWidth}
          />
          <QueryInspectorPanel
            connections={connections}
            detailView={state.detailView}
            selectedQuery={selectedRecentQuery}
            width={detailPaneWidth}
          />
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
      <FocusNavigationHint />
    </box>
  )
}

function SaveQueryDialogOverlay(props: SaveQueryDialogState & {
  onCancel: () => void
  onSave: (name: string) => void | Promise<void>
  termHeight: number
  termWidth: number
}) {
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

function RecentQueryView(props: {
  queries: RecentQuery[]
  connections: Connection<any>[]
  selectedQueryId?: string
  onActivate: (query: RecentQuery) => void
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
  queries: RecentQuery[]
  connections: Connection<any>[]
  selectedQueryId?: string
  onActivate: (query: RecentQuery) => void
  width?: number
}) {
  const { queries, connections, onActivate, selectedQueryId, width } = props
  const { inChordRef } = useKeybind()
  const tree = useFocusTree()
  const theme = useTheme()
  const focusedWithin = useIsFocusWithin([RECENT_QUERY_FOCUS_ID])
  const navigationActive = useIsFocusNavigationActive()
  const focusedDescendantPath = useFocusedDescendantPath()
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!queries.some((query) => query.isActive)) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [queries])

  const focusedQueryId = resolveRecentQueryId(focusedDescendantPath)
  const currentQueryId = focusedQueryId ?? selectedQueryId ?? queries[0]?.queryId
  const selectedIndex = queries.findIndex((query) => query.queryId === currentQueryId)
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
          <text
            fg={row.kind === "query" ? (row.dimmed ? theme.mutedFg : recentQueryStatusColor(row.query, theme)) : undefined}
            wrapMode="none"
            truncate
          >
            {row.kind === "query" ? recentQueryStatusGlyph(row.query) : ""}
          </text>
        ),
      },
      started: {
        width: { absolute: 12 },
        Cell: ({ row }) => (
          <text fg={row.kind === "query" && row.dimmed ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? formatTime(row.query.startedAt) : ""}
          </text>
        ),
      },
      query: {
        width: { grow: 4 },
        Cell: ({ row }) => (
          <text fg={row.kind === "query" && row.dimmed ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? truncateSql(row.query.text, 120) : ""}
          </text>
        ),
      },
      elapsed: {
        width: { absolute: 8 },
        Cell: ({ row }) => (
          <text fg={row.kind === "query" ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? formatRecentQueryElapsed(row.query, row.now) : ""}
          </text>
        ),
      },
      connection: {
        width: { grow: 2 },
        Cell: ({ row }) => (
          <text fg={row.kind === "query" ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {row.kind === "query" ? row.connectionName : ""}
          </text>
        ),
      },
    }),
    [theme],
  )

  useEffect(() => {
    if (queries.length === 0 || focusedDescendantPath || !focusedWithin) {
      return
    }

    const query = queries.find((candidate) => candidate.queryId === (selectedQueryId ?? currentQuery?.queryId)) ?? currentQuery
    if (!query) {
      return
    }
    queueMicrotask(() => {
      tree.focusPath(recentQueryRowPath(query.queryId))
    })
  }, [currentQuery, focusedDescendantPath, focusedWithin, queries, selectedQueryId, tree])

  function focusRow(nextIndex: number) {
    const query = queries[nextIndex]
    if (!query) {
      return
    }
    tree.focusPath(recentQueryRowPath(query.queryId))
  }

  useKeyboard((key) => {
    if (navigationActive || inChordRef.current || !focusedWithin || queries.length === 0) {
      return
    }

    switch (key.name) {
      case "up":
        key.preventDefault()
        key.stopPropagation()
        focusRow(Math.max(0, currentIndex - 1))
        return
      case "down":
        key.preventDefault()
        key.stopPropagation()
        focusRow(Math.min(queries.length - 1, currentIndex + 1))
        return
      case "enter":
      case "return":
        key.preventDefault()
        key.stopPropagation()
        if (currentQuery) {
          onActivate(currentQuery)
        }
    }
  })

  return (
    <box flexDirection="column" position="relative">
      <Focusable focusableId={RECENT_QUERY_AREA_ID}>
        <QueryListTable
          rows={displayRows}
          columns={columns}
          width={width}
          getRowKey={(row) => (row.kind === "query" ? row.query.queryId : row.id)}
          getRowFocusableId={(row) => (row.kind === "query" ? recentQueryFocusId(row.query.queryId) : undefined)}
          isRowDimmed={(row) => row.kind === "query" ? row.dimmed : false}
          isRowFocused={(row) =>
            row.kind === "query" ? sameFocusPath(recentQueryRowPath(row.query.queryId), focusedDescendantPath) : false}
          isRowSelected={(row) => row.kind === "query" ? row.query.queryId === selectedQueryId : false}
        />
      </Focusable>
      <FocusHalo />
    </box>
  )
}

function QueryInspectorPanel(props: {
  detailView: DetailView
  selectedQuery: RecentQuery | undefined
  connections: Connection<any>[]
  width?: number
}) {
  return (
    <Focusable
      flexDirection="column"
      flexGrow={1}
      focusSelf
      focusable
      focusableId={QUERY_INSPECTOR_FOCUS_ID}
      position="relative"
    >
      <box flexDirection="column" flexGrow={1} position="relative">
        <QueryInspectorSurface
          connections={props.connections}
          detailView={props.detailView}
          selectedQuery={props.selectedQuery}
          width={props.width}
        />
        <FocusHalo />
      </box>
    </Focusable>
  )
}

function QueryInspectorSurface(props: {
  detailView: DetailView
  selectedQuery: RecentQuery | undefined
  connections: Connection<any>[]
  width?: number
}) {
  const { detailView, selectedQuery, connections, width } = props
  const theme = useTheme()
  const focusedWithin = useIsFocusWithin([QUERY_INSPECTOR_FOCUS_ID])
  const navigationActive = useIsFocusNavigationActive()
  const [now, setNow] = useState(Date.now)
  const chromeBg = navigationActive && focusedWithin ? theme.focusNavBg : (focusedWithin ? theme.focusBg : theme.inputBg)

  useEffect(() => {
    if (!selectedQuery?.isActive) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [selectedQuery?.isActive])

  if (selectedQuery) {
    const connectionName = connections.find((connection) => connection.id === selectedQuery.connectionId)?.name ?? "Unknown connection"
    return (
      <box flexDirection="column" flexGrow={1}>
        <box backgroundColor={chromeBg} flexDirection="column" paddingLeft={1} paddingRight={1}>
          <box flexDirection="row" gap={1}>
            <text fg={recentQueryStatusColor(selectedQuery, theme)}>{recentQueryStatusGlyph(selectedQuery)}</text>
            <text fg={theme.mutedFg}>{recentQueryStatusText(selectedQuery)}</text>
            <text flexGrow={1} flexShrink={1} wrapMode="none" truncate>
              {connectionName}
            </text>
            <text fg={theme.mutedFg} wrapMode="none" truncate>
              {formatTime(selectedQuery.startedAt)} | {formatRecentQueryElapsed(selectedQuery, now)}
            </text>
          </box>
          <text wrapMode="none" truncate>{truncateSql(selectedQuery.text, Math.max(72, (width ?? 72) * 2))}</text>
        </box>
        {renderSelectedQueryDetail(selectedQuery, theme, width)}
      </box>
    )
  }

  return renderFallbackDetailView(detailView, theme, width)
}

function renderSelectedQueryDetail(query: RecentQuery, theme: ReturnType<typeof useTheme>, width?: number) {
  switch (query.status) {
    case "success":
      if ((query.execution?.rows.length ?? 0) === 0) {
        return renderCenteredState(theme, "No rows returned")
      }
      return (
        <box flexDirection="column" flexGrow={1}>
          <ResultsTable rows={query.execution?.rows ?? []} width={width} />
        </box>
      )
    case "pending":
      return renderCenteredState(theme, "Query running", "Results will appear here when it completes.")
    case "cancelled":
      return renderCenteredState(theme, "Query cancelled", query.execution?.error ?? "Execution was cancelled.")
    case "error":
      return renderCenteredState(theme, "Query failed", query.execution?.error ?? "Query failed.")
  }
}

function renderFallbackDetailView(detailView: DetailView, theme: ReturnType<typeof useTheme>, width?: number) {
  switch (detailView.kind) {
    case "rows":
      if (detailView.rows.length === 0) {
        return renderCenteredState(theme, "No rows returned")
      }
      return (
        <box flexDirection="column" flexGrow={1}>
          <ResultsTable rows={detailView.rows} width={width} />
        </box>
      )
    case "error":
      return renderCenteredState(theme, detailView.title ?? "Error", detailView.message)
    case "empty":
      return renderCenteredState(theme, "No query run selected")
  }
}

function renderCenteredState(theme: ReturnType<typeof useTheme>, title: string, message?: string) {
  return (
    <box alignItems="center" flexDirection="column" flexGrow={1} justifyContent="center" paddingLeft={1} paddingRight={1}>
      <text fg={theme.mutedFg}>{title}</text>
      {message && <text fg={theme.mutedFg} wrapMode="word">{message}</text>}
    </box>
  )
}

function buildRecentQueries(
  engine: SqlVisor,
  activeQueries: ActiveQuery[],
  history: QueryExecution[],
  selectedQueryId?: string,
  showSystemQueries = false,
): RecentQuery[] {
  const activeIds = new Set(activeQueries.map((query) => query.queryId))
  const runningQueries = [...activeQueries]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((query) => {
      const state = engine.getQueryState({ queryId: query.queryId })
      return {
        queryId: query.queryId,
        text: state.data?.sql.source ?? query.text,
        connectionId: state.data?.connectionId ?? query.connectionId,
        initiator: state.data?.initiator ?? "user",
        startedAt: state.data?.createdAt ?? query.startedAt,
        status: state.data?.status ?? "pending",
        isActive: true,
        execution: state.data,
      } satisfies RecentQuery
    })
    .filter((query) => showSystemQueries || query.initiator === "user")

  const finishedQueries = history
    .filter((execution) => showSystemQueries || execution.initiator === "user")
    .filter((execution) => !activeIds.has(execution.id))
    .map((execution) => ({
      queryId: execution.id,
      text: execution.sql.source,
      connectionId: execution.connectionId,
      initiator: execution.initiator,
      startedAt: execution.createdAt,
      status: execution.status,
      isActive: false,
      execution,
    }) satisfies RecentQuery)
  const visibleFinishedQueries = finishedQueries.slice(0, 2)
  const selectedFinishedQuery = selectedQueryId
    ? finishedQueries.find((query) => query.queryId === selectedQueryId && !visibleFinishedQueries.some((candidate) => candidate.queryId === selectedQueryId))
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

function recentQueryStatusGlyph(query: RecentQuery): string {
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

function recentQueryStatusText(query: RecentQuery): string {
  switch (query.status) {
    case "pending":
      return "Running"
    case "success":
      return "Succeeded"
    case "error":
      return "Failed"
    case "cancelled":
      return "Cancelled"
  }
}

function recentQueryStatusColor(query: RecentQuery, theme: ReturnType<typeof useTheme>): string {
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

export function recentQueryFocusId(queryId: string): string {
  return `query-${queryId}`
}

function recentQueryRowPath(queryId: string): readonly [string, string, string] {
  return [RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(queryId)]
}

function resolveRecentQueryId(path: readonly string[] | undefined): string | undefined {
  const queryId = path?.[2]
  if (
    !path ||
    path.length !== 3 ||
    path[0] !== RECENT_QUERY_FOCUS_ID ||
    path[1] !== RECENT_QUERY_AREA_ID ||
    !queryId?.startsWith("query-")
  ) {
    return undefined
  }

  return queryId.slice("query-".length)
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

function formatRecentQueryElapsed(query: RecentQuery, now: number): string {
  const endTime = query.execution?.finishedAt ?? now
  return formatElapsed(Math.max(0, endTime - query.startedAt))
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function truncateSql(sql: string, max: number): string {
  const oneLine = sql.replace(/\s+/g, " ").trim()
  if (oneLine.length <= max) return oneLine
  return oneLine.slice(0, max) + "..."
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
