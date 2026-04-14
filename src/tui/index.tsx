import { createCliRenderer, type MouseEvent } from "@opentui/core"
import { createRoot, flushSync, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SqlVisor, type ActiveQuery, type DetailView, type QueryExecution } from "../index"
import type { Connection } from "../lib/types/Connection"
import { AddConnectionPane } from "./connection/AddConnectionPane"
import { ResultsTable } from "./dataview/ResultsTable"
import { EditorView } from "./editor/EditorView"
import { QueryHistory } from "./editor/QueryHistory"
import {
  FocusHalo,
  FocusNavigable,
  FocusNavigableArea,
  FocusNavigationHint,
  FocusProvider,
  useFocusTree,
  useIsFocusNavigableFocused,
  useIsFocusNavigableHighlighted,
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

type RecentQuery = {
  queryId: string
  text: string
  connectionId: string
  startedAt: number
  status: QueryExecution["status"]
  isActive: boolean
  execution?: QueryExecution
}

const MIN_SIDEBAR_WIDTH = 15
const MIN_PANE_HEIGHT = 3

export const RECENT_QUERY_FOCUS_ID = "recent-query-view"
export const RECENT_QUERY_AREA_ID = "recent-query-list"
export const QUERY_INSPECTOR_FOCUS_ID = "query-inspector"

export function App() {
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const renderer = useRenderer()
  const tree = useFocusTree()
  const [pane, setPane] = useState<TopRightPane>("editor")
  const [sidebarWidth, setSidebarWidth] = useState(30)
  const [editorHeight, setEditorHeight] = useState(12)
  const [inspectedRecentQueryId, setInspectedRecentQueryId] = useState<string | undefined>()
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState<"sidebar" | "editor" | null>(null)
  const connections = state.connections.data ?? []
  const recentQueries = useMemo(
    () => buildRecentQueries(engine, state.activeQueries, state.history),
    [engine, state.activeQueries, state.history],
  )
  const inspectedRecentQuery = inspectedRecentQueryId
    ? recentQueries.find((query) => query.queryId === inspectedRecentQueryId)
    : undefined

  useEffect(() => {
    if (inspectedRecentQueryId && !recentQueries.some((query) => query.queryId === inspectedRecentQueryId)) {
      setInspectedRecentQueryId(undefined)
    }
  }, [inspectedRecentQueryId, recentQueries])

  useShortcut({
    keys: "ctrl+c",
    enabled: state.activeQueries.length > 0,
    onKey: () => engine.cancelRunningQueries(),
  })

  const handleExecute = async (sql: string) => {
    setInspectedRecentQueryId(undefined)
    try {
      await engine.runQuery({ text: sql })
    } catch {
      // the engine already records error state and history
    }
  }

  const handleRestoreQuery = (entry: QueryExecution) => {
    setInspectedRecentQueryId(undefined)
    engine.restoreQueryExecution(entry.id)
    setPane("editor")
  }

  const handleInspectRecentQuery = useCallback(
    (query: RecentQuery) => {
      flushSync(() => {
        setInspectedRecentQueryId(query.queryId)
      })
      blurFocusedRenderable(renderer)
      tree.focusPath([QUERY_INSPECTOR_FOCUS_ID])
    },
    [renderer, tree],
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
              autoFocus
              onAddConnection={() => setPane("add-connection")}
              text={state.queryEditor.text}
              onTextChange={(text) => engine.setQueryEditorState({ text })}
              onExecute={handleExecute}
              onHistory={() => setPane("history")}
            />
          )}
          {pane === "history" && (
            <QueryHistory
              connections={connections}
              entries={state.history}
              onRestore={handleRestoreQuery}
              onBack={() => setPane("editor")}
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
          <RecentQueryView connections={connections} queries={recentQueries} onInspect={handleInspectRecentQuery} />
          <QueryInspectorPanel
            connections={connections}
            detailView={state.detailView}
            inspectedQuery={inspectedRecentQuery}
          />
        </box>
      </box>
      <FocusNavigationHint />
    </box>
  )
}

function RecentQueryView(props: {
  queries: RecentQuery[]
  connections: Connection<any>[]
  onInspect: (query: RecentQuery) => void
}) {
  const { queries, connections, onInspect } = props
  const { inChordRef } = useKeybind()
  const renderer = useRenderer()
  const tree = useFocusTree()
  const theme = useTheme()
  const focusedWithin = useIsFocusWithin([RECENT_QUERY_FOCUS_ID])
  const navigationActive = useIsFocusNavigationActive()
  const [selectedQueryId, setSelectedQueryId] = useState<string | undefined>(queries[0]?.queryId)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    setSelectedQueryId((current) => {
      if (current && queries.some((query) => query.queryId === current)) {
        return current
      }
      return queries[0]?.queryId
    })
  }, [queries])

  useEffect(() => {
    if (!queries.some((query) => query.isActive)) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [queries])

  const selectedIndex = queries.findIndex((query) => query.queryId === selectedQueryId)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0

  useEffect(() => {
    if (!focusedWithin) {
      return
    }

    const query = queries[currentIndex]
    queueMicrotask(() => {
      tree.setFocusedPath(query ? recentQueryRowPath(query.queryId) : [RECENT_QUERY_FOCUS_ID])
    })
  }, [currentIndex, focusedWithin, queries, tree])

  function focusSelectedRowDeferred() {
    const query = queries[currentIndex] ?? queries[0]
    if (!query) {
      return
    }

    blurFocusedRenderable(renderer)
    queueMicrotask(() => {
      setSelectedQueryId(query.queryId)
      tree.focusPath(recentQueryRowPath(query.queryId))
    })
  }

  function focusRow(nextIndex: number) {
    const query = queries[nextIndex]
    if (!query) {
      return
    }
    setSelectedQueryId(query.queryId)
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
      case "return": {
        key.preventDefault()
        key.stopPropagation()
        const query = queries[currentIndex]
        if (!query) {
          return
        }
        onInspect(query)
      }
    }
  })

  return (
    <FocusNavigable
      flexDirection="column"
      focus={focusSelectedRowDeferred}
      focusNavigableId={RECENT_QUERY_FOCUS_ID}
      position="relative"
    >
      <box flexDirection="column" position="relative">
        <FocusNavigableArea flexDirection="column" focusNavigableId={RECENT_QUERY_AREA_ID}>
          <box flexDirection="column">
            <box backgroundColor={theme.inputBg} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
              <text>Recent Queries</text>
              {queries.length === 0 && <text opacity={0.6}>No recent queries yet.</text>}
              {queries.length > 0 && <text opacity={0.6}>up/down select</text>}
              {queries.length > 0 && <text opacity={0.6}>enter inspect</text>}
              {queries.some((query) => query.isActive) && <text opacity={0.6}>^C cancel running</text>}
            </box>
            {queries.map((query, index) => {
              const connectionName = connections.find((connection) => connection.id === query.connectionId)?.name ?? ""
              return (
                <FocusNavigable
                  key={query.queryId}
                  focus={() => {
                    blurFocusedRenderable(renderer)
                    setSelectedQueryId(query.queryId)
                  }}
                  focusNavigableId={recentQueryFocusId(query.queryId)}
                >
                  <RecentQueryRow
                    active={index === currentIndex}
                    connectionName={connectionName}
                    now={now}
                    query={query}
                  />
                </FocusNavigable>
              )
            })}
          </box>
        </FocusNavigableArea>
        <FocusHalo />
      </box>
    </FocusNavigable>
  )
}

function RecentQueryRow(props: {
  query: RecentQuery
  now: number
  connectionName: string
  active: boolean
}) {
  const { query, now, connectionName, active } = props
  const theme = useTheme()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()

  return (
    <box
      backgroundColor={navigationActive && highlighted ? theme.focusNavBg : (active ? theme.focusBg : undefined)}
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.mutedFg}>{recentQueryStatusLabel(query)}</text>
      <text>{formatTime(query.startedAt)}</text>
      <text flexGrow={1} flexShrink={1}>{truncateSql(query.text, 60)}</text>
      <text>{formatRecentQueryElapsed(query, now)}</text>
      <text>{connectionName}</text>
    </box>
  )
}

function QueryInspectorPanel(props: {
  detailView: DetailView
  inspectedQuery: RecentQuery | undefined
  connections: Connection<any>[]
}) {
  return (
    <FocusNavigable
      flexDirection="column"
      flexGrow={1}
      focus={noop}
      focusNavigableId={QUERY_INSPECTOR_FOCUS_ID}
      position="relative"
    >
      <box flexDirection="column" flexGrow={1} position="relative">
        <QueryInspectorSurface
          connections={props.connections}
          detailView={props.detailView}
          inspectedQuery={props.inspectedQuery}
        />
        <FocusHalo />
      </box>
    </FocusNavigable>
  )
}

function QueryInspectorSurface(props: {
  detailView: DetailView
  inspectedQuery: RecentQuery | undefined
  connections: Connection<any>[]
}) {
  const { detailView, inspectedQuery, connections } = props
  const theme = useTheme()
  const focused = useIsFocusNavigableFocused()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const [now, setNow] = useState(Date.now)
  const headerBg = navigationActive && highlighted ? theme.focusNavBg : (focused ? theme.focusBg : theme.inputBg)

  useEffect(() => {
    if (!inspectedQuery?.isActive) {
      return
    }
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [inspectedQuery?.isActive])

  if (inspectedQuery) {
    const connectionName = connections.find((connection) => connection.id === inspectedQuery.connectionId)?.name ?? ""
    return (
      <box flexDirection="column" flexGrow={1}>
        <box backgroundColor={headerBg} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
          <text>Inspector</text>
          <text>{recentQueryStatusLabel(inspectedQuery)}</text>
          <text flexGrow={1} flexShrink={1}>{truncateSql(inspectedQuery.text, 72)}</text>
        </box>
        <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
          <text>Query: {truncateSql(inspectedQuery.text, 120)}</text>
          <text>
            {connectionName ? `Connection: ${connectionName}` : "Connection: unknown"} | Started: {formatTime(inspectedQuery.startedAt)} | Elapsed:{" "}
            {formatRecentQueryElapsed(inspectedQuery, now)}
          </text>
          {inspectedQuery.status === "success" && (
            <>
              <text>Rows: {inspectedQuery.execution?.rowCount ?? 0}</text>
              <ResultsTable rows={inspectedQuery.execution?.rows ?? []} />
            </>
          )}
          {inspectedQuery.status === "pending" && (
            <>
              <text>Running query...</text>
              <text>Results and final status will appear here when the query completes.</text>
            </>
          )}
          {(inspectedQuery.status === "error" || inspectedQuery.status === "cancelled") && (
            <>
              <text>{inspectedQuery.status === "cancelled" ? "Query Cancelled" : "Query Error"}</text>
              <text>{inspectedQuery.execution?.error ?? "Query failed."}</text>
            </>
          )}
        </box>
      </box>
    )
  }

  return renderFallbackDetailView(detailView, headerBg)
}

function renderFallbackDetailView(detailView: DetailView, headerBg: string) {
  switch (detailView.kind) {
    case "rows":
      return (
        <box flexDirection="column" flexGrow={1}>
          <box backgroundColor={headerBg} flexDirection="row" paddingLeft={1} paddingRight={1}>
            <text>Inspector</text>
          </box>
          <box flexDirection="column" flexGrow={1}>
            <text>{detailView.title ?? `Results (${detailView.rows.length})`}</text>
            <ResultsTable rows={detailView.rows} />
          </box>
        </box>
      )
    case "error":
      return (
        <box flexDirection="column" flexGrow={1}>
          <box backgroundColor={headerBg} flexDirection="row" paddingLeft={1} paddingRight={1}>
            <text>Inspector</text>
          </box>
          <box flexDirection="column" flexGrow={1}>
            <text>{detailView.title ?? "Error"}</text>
            <text>{detailView.message}</text>
          </box>
        </box>
      )
    case "empty":
      return (
        <box flexDirection="column" flexGrow={1}>
          <box backgroundColor={headerBg} flexDirection="row" paddingLeft={1} paddingRight={1}>
            <text>Inspector</text>
          </box>
          <box flexDirection="column" flexGrow={1}>
            <text>{detailView.title ?? "Details"}</text>
            <text>{detailView.message ?? "Nothing selected."}</text>
          </box>
        </box>
      )
  }
}

function buildRecentQueries(engine: SqlVisor, activeQueries: ActiveQuery[], history: QueryExecution[]): RecentQuery[] {
  const activeIds = new Set(activeQueries.map((query) => query.queryId))
  const runningQueries = [...activeQueries]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((query) => {
      const state = engine.getQueryState({ queryId: query.queryId })
      return {
        queryId: query.queryId,
        text: state.data?.sql.source ?? query.text,
        connectionId: state.data?.connectionId ?? query.connectionId,
        startedAt: state.data?.createdAt ?? query.startedAt,
        status: state.data?.status ?? "pending",
        isActive: true,
        execution: state.data,
      } satisfies RecentQuery
    })

  const finishedQueries = history
    .filter((execution) => !activeIds.has(execution.id))
    .slice(0, 2)
    .map((execution) => ({
      queryId: execution.id,
      text: execution.sql.source,
      connectionId: execution.connectionId,
      startedAt: execution.createdAt,
      status: execution.status,
      isActive: false,
      execution,
    }) satisfies RecentQuery)

  return [...runningQueries, ...finishedQueries]
}

export function recentQueryFocusId(queryId: string): string {
  return `query-${queryId}`
}

function recentQueryRowPath(queryId: string): readonly [string, string, string] {
  return [RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(queryId)]
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

function formatRecentQueryElapsed(query: RecentQuery, now: number): string {
  const endTime = query.execution?.finishedAt ?? now
  return formatElapsed(Math.max(0, endTime - query.startedAt))
}

function recentQueryStatusLabel(query: RecentQuery): string {
  switch (query.status) {
    case "pending":
      return "[running]"
    case "success":
      return "[done]"
    case "error":
      return "[error]"
    case "cancelled":
      return "[cancelled]"
  }
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

function noop() {}

function blurFocusedRenderable(renderer: ReturnType<typeof useRenderer>) {
  renderer.currentFocusedRenderable?.blur()
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
