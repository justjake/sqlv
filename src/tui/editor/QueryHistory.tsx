import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"
import type { QueryExecution } from "../../index"
import { Shortcut } from "../Shortcut"

type QueryHistoryProps = {
  entries: QueryExecution[]
  onRestore: (entry: QueryExecution) => void
  onBack: () => void
}

export function QueryHistory(props: QueryHistoryProps) {
  const { entries, onRestore, onBack } = props
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    setSelectedIndex((index) => clampHistoryIndex(index, entries.length))
  }, [entries.length])

  useKeyboard((key) => {
    if (entries.length === 0) {
      return
    }

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
        <box key={entry.id} backgroundColor={i === selectedIndex ? "blue" : undefined} paddingLeft={1} paddingRight={1}>
          <text>
            {new Date(entry.finishedAt ?? entry.updatedAt ?? entry.createdAt).toLocaleTimeString()} {"\u2014"}{" "}
            {entry.status !== "success" ? `[${entry.status}] ` : ""}
            {entry.sql.source.slice(0, 60)}
            {entry.sql.source.length > 60 ? "..." : ""}
          </text>
        </box>
      ))}
    </box>
  )
}

function clamp(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

export const clampHistoryIndex = clamp
