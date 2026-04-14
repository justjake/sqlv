import { createCliRenderer, type MouseEvent } from "@opentui/core"
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useRef, useState } from "react"
import { SqlVisor, type DetailView, type QueryExecution, type QueryExecutionState } from "../index"
import { AddConnectionPane } from "./connection/AddConnectionPane"
import { JsonRowView } from "./dataview/JsonRowView"
import { EditorView } from "./editor/EditorView"
import { QueryHistory } from "./editor/QueryHistory"
import { Separator } from "./Separator"
import { Shortcut } from "./Shortcut"
import { Sidebar } from "./sidebar/Sidebar"
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
              focused
              onAddConnection={() => setPane("add-connection")}
              text={state.queryEditor.text}
              onTextChange={(text) => engine.setQueryEditorState({ text })}
              onExecute={handleExecute}
              onHistory={() => setPane("history")}
            />
          )}
          {pane === "history" && (
            <QueryHistory entries={state.history} onRestore={handleRestoreQuery} onBack={() => setPane("editor")} />
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
          <DetailViewPanel detailView={state.detailView} queryExecution={state.queryExecution} />
        </box>
      </box>
    </box>
  )
}

function DetailViewPanel(props: { detailView: DetailView; queryExecution: QueryExecutionState }) {
  if (props.queryExecution.fetchStatus === "fetching") {
    return (
      <box flexDirection="column" flexGrow={1}>
        <text>Running Query</text>
        <text>Executing query...</text>
      </box>
    )
  }

  switch (props.detailView.kind) {
    case "rows":
      return (
        <box flexDirection="column" flexGrow={1}>
          <text>{props.detailView.title ?? `Results (${props.detailView.rows.length})`}</text>
          <JsonRowView rows={props.detailView.rows} />
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

if (import.meta.main) {
  const engine = await SqlVisor.create()
  const renderer = await createCliRenderer()
  createRoot(renderer).render(
    <SqlVisorProvider engine={engine}>
      <App />
    </SqlVisorProvider>,
  )
}
