import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useEffect, useState } from "react"
import { init } from "../lib/init"
import { JsonRowView } from "./dataview/JsonRowView"
import { EditorView } from "./editor/EditorView"
import { QueryHistory, type HistoryEntry } from "./editor/QueryHistory"
import { Shortcut } from "./Shortcut"
import { Sidebar } from "./sidebar/Sidebar"
import { EnvProvider, useEnv } from "./useEnv"

type TopRightPane = "editor" | "history" | "add-connection"

export function App() {
  const env = useEnv()
  const { session, persist } = env

  const [pane, setPane] = useState<TopRightPane>("editor")
  const [editorKey, setEditorKey] = useState(0)
  const [editorInitialText, setEditorInitialText] = useState("")
  const [result, setResult] = useState<object[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    persist.log.insert(session)
  }, [session, persist])

  const handleExecute = (sql: string) => {
    // TODO: execute query via selected connection's QueryService
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      sql,
      executedAt: Date.now(),
      rows: [],
    }
    setHistory((prev) => [entry, ...prev])
  }

  const handleRestoreQuery = (entry: HistoryEntry) => {
    setEditorInitialText(entry.sql)
    setEditorKey((k) => k + 1)
    setResult(entry.rows)
    setPane("editor")
  }

  return (
    <box flexDirection="row" flexGrow={1}>
      {/* Left Sidebar */}
      <box flexDirection="column" flexBasis={30} paddingRight={1}>
        <Sidebar onAddConnection={() => setPane("add-connection")} />
      </box>

      {/* Right Column */}
      <box flexDirection="column" flexGrow={1}>
        {/* Top Right: Editor / History / Add Connection */}
        <box flexDirection="column" flexGrow={1}>
          {pane === "editor" && (
            <EditorView
              key={editorKey}
              focused
              initialText={editorInitialText}
              onExecute={handleExecute}
              onHistory={() => setPane("history")}
            />
          )}
          {pane === "history" && (
            <QueryHistory
              entries={history}
              onRestore={handleRestoreQuery}
              onBack={() => setPane("editor")}
            />
          )}
          {pane === "add-connection" && (
            <box flexDirection="column" padding={1}>
              <box flexDirection="row" gap={1}>
                <Shortcut label="Back" name="escape" enabled onKey={() => setPane("editor")} />
              </box>
              <text>Add Connection (TODO)</text>
            </box>
          )}
        </box>

        {/* Bottom Right: Results */}
        <box flexDirection="column" flexGrow={1} paddingTop={1}>
          <text>Results ({result.length} rows)</text>
          <JsonRowView rows={result} />
        </box>
      </box>
    </box>
  )
}

if (import.meta.main) {
  const env = await init()
  const renderer = await createCliRenderer()
  createRoot(renderer).render(
    <EnvProvider value={env}>
      <App />
    </EnvProvider>,
  )
}
