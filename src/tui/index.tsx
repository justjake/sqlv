import { createCliRenderer, type MouseEvent } from "@opentui/core"
import { createRoot, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { SqlVisor, type ActiveQuery, type DetailView, type QueryExecution } from "../index"
import type { Connection } from "../lib/types/Connection"
import { AddConnectionPane } from "./connection/AddConnectionPane"
import { ResultsTable } from "./dataview/ResultsTable"
import { EditorView } from "./editor/EditorView"
import { QueryHistory } from "./editor/QueryHistory"
import { FocusNavigationHint, FocusProvider } from "./focus"
import { Separator } from "./Separator"
import { Sidebar } from "./sidebar/Sidebar"
import { KeybindProvider, useShortcut } from "./ui/keybind"
import { ThemeProvider, useTheme } from "./ui/theme"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "./useSqlVisor"

type TopRightPane = "editor" | "history" | "add-connection"

const MIN_SIDEBAR_WIDTH = 15
const MIN_PANE_HEIGHT = 3

type DragState = { type: "sidebar" | "editor"; lastPos: number }

export function App() {
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const [pane, setPane] = useState<TopRightPane>("editor")
  const [sidebarWidth, setSidebarWidth] = useState(30)
  const [editorHeight, setEditorHeight] = useState(12)
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState<"sidebar" | "editor" | null>(null)

  useShortcut({
    keys: "ctrl+c",
    enabled: state.activeQueries.length > 0,
    onKey: () => engine.cancelRunningQueries(),
  })

  const handleExecute = async (sql: string) => {
    try {
      await engine.runQuery({ text: sql })
    } catch {
      // the engine already records error state and history
    }
  }

  const handleRestoreQuery = (entry: QueryExecution) => {
    engine.restoreQueryExecution(entry.id)
    setPane("editor")
  }

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
              connections={state.connections.data ?? []}
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
          <ActiveQueryBar
            activeQueries={state.activeQueries}
            connections={state.connections.data ?? []}
          />
          <DetailViewPanel detailView={state.detailView} />
        </box>
      </box>
      <FocusNavigationHint />
    </box>
  )
}

// ── Active Query Bar ────────────────────────────────────────────────────────

function ActiveQueryBar(props: { activeQueries: ActiveQuery[]; connections: Connection<any>[] }) {
  const { activeQueries, connections } = props
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (activeQueries.length === 0) return
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [activeQueries.length])

  if (activeQueries.length === 0) return null

  return (
    <box flexDirection="column">
      {activeQueries.map((q, i) => {
        const connName = connections.find((c) => c.id === q.connectionId)?.name ?? ""
        return (
          <ActiveQueryRow key={q.queryId} query={q} now={now} connectionName={connName} isLast={i === activeQueries.length - 1} />
        )
      })}
    </box>
  )
}

function ActiveQueryRow(props: { query: ActiveQuery; now: number; connectionName: string; isLast: boolean }) {
  const { query, now, connectionName, isLast } = props
  const theme = useTheme()
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} backgroundColor={theme.focusBg}>
      <text>{formatTime(query.startedAt)}</text>
      <text flexGrow={1} flexShrink={1}>{truncateSql(query.text, 60)}</text>
      <text>{formatElapsed(now - query.startedAt)}</text>
      <text>{connectionName}</text>
      {isLast && <text opacity={0.5}>^C cancel</text>}
    </box>
  )
}

// ── Detail View ─────────────────────────────────────────────────────────────

function DetailViewPanel(props: { detailView: DetailView }) {
  switch (props.detailView.kind) {
    case "rows":
      return (
        <box flexDirection="column" flexGrow={1}>
          <text>{props.detailView.title ?? `Results (${props.detailView.rows.length})`}</text>
          <ResultsTable rows={props.detailView.rows} />
        </box>
      )
    case "error":
      return (
        <box flexDirection="column" flexGrow={1}>
          <text>{props.detailView.title ?? "Error"}</text>
          <text>{props.detailView.message}</text>
        </box>
      )
    case "empty":
      return (
        <box flexDirection="column" flexGrow={1}>
          <text>{props.detailView.title ?? "Details"}</text>
          <text>{props.detailView.message ?? "Nothing selected."}</text>
        </box>
      )
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
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
