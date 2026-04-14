import { useKeyboard } from "@opentui/react"
import { useState } from "react"
import { Shortcut } from "../Shortcut"

export type HistoryEntry = {
  id: string
  sql: string
  executedAt: number
  rows: object[]
  error?: string
}

type QueryHistoryProps = {
  entries: HistoryEntry[]
  onRestore: (entry: HistoryEntry) => void
  onBack: () => void
}

export function QueryHistory(props: QueryHistoryProps) {
  const { entries, onRestore, onBack } = props
  const [selectedIndex, setSelectedIndex] = useState(0)

  useKeyboard((key) => {
    switch (key.name) {
      case "up":
        setSelectedIndex((i) => Math.max(0, i - 1))
        break
      case "down":
        setSelectedIndex((i) => Math.min(entries.length - 1, i + 1))
        break
      case "enter": {
        const entry = entries[selectedIndex]
        if (entry) {
          onRestore(entry)
        }
        break
      }
    }
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1}>
        <Shortcut label="Back" name="escape" enabled onKey={onBack} />
        <Shortcut label="Back" ctrl name="r" enabled onKey={onBack} />
      </box>
      {entries.length === 0 && <text>No query history yet.</text>}
      {entries.map((entry, i) => (
        <box
          key={entry.id}
          backgroundColor={i === selectedIndex ? "blue" : undefined}
          paddingLeft={1}
          paddingRight={1}
        >
          <text>
            {new Date(entry.executedAt).toLocaleTimeString()} {"\u2014"} {entry.sql.slice(0, 60)}
            {entry.sql.length > 60 ? "..." : ""}
          </text>
        </box>
      ))}
    </box>
  )
}
