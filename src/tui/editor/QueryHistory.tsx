import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"
import type { QueryExecution } from "../../index"
import type { Connection } from "../../lib/types/Connection"
import {
  FocusNavigable,
  FocusNavigableArea,
  useFocusTree,
  useIsFocusNavigableHighlighted,
  useIsFocusNavigationActive,
  useIsFocusWithin,
} from "../focus"
import { Shortcut } from "../Shortcut"
import { useTheme } from "../ui/theme"

type QueryHistoryProps = {
  connections: Connection<any>[]
  entries: QueryExecution[]
  onRestore: (entry: QueryExecution) => void
  onBack: () => void
}

export const QUERY_HISTORY_AREA_ID = "query-history"

export function QueryHistory(props: QueryHistoryProps) {
  const { connections, entries, onRestore, onBack } = props
  const [selectedIndex, setSelectedIndex] = useState(0)
  const tree = useFocusTree()
  const navigationActive = useIsFocusNavigationActive()
  const focusedWithin = useIsFocusWithin([QUERY_HISTORY_AREA_ID])

  useEffect(() => {
    setSelectedIndex((index) => clampHistoryIndex(index, entries.length))
  }, [entries.length])

  useEffect(() => {
    queueMicrotask(() => {
      const entry = entries[selectedIndex]
      if (entry) {
        tree.setFocusedPath([QUERY_HISTORY_AREA_ID, entryFocusId(entry.id)])
        return
      }
      tree.setFocusedPath([QUERY_HISTORY_AREA_ID, "empty"])
    })
  }, [entries, selectedIndex, tree])

  const selectedEntry = entries[selectedIndex]

  function focusRow(index: number) {
    const entry = entries[index]
    if (!entry) {
      return
    }
    setSelectedIndex(index)
    tree.focusPath([QUERY_HISTORY_AREA_ID, entryFocusId(entry.id)])
  }

  useKeyboard((key) => {
    if (navigationActive || !focusedWithin || entries.length === 0) {
      return
    }

    switch (key.name) {
      case "up":
        focusRow(Math.max(0, selectedIndex - 1))
        break
      case "down":
        focusRow(Math.min(entries.length - 1, selectedIndex + 1))
        break
      case "enter":
        if (selectedEntry) {
          onRestore(selectedEntry)
        }
        break
    }
  })

  return (
    <FocusNavigableArea flexDirection="column" flexGrow={1} focusNavigableId={QUERY_HISTORY_AREA_ID}>
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" gap={1}>
          <Shortcut keys="ctrl+r" label="Back" enabled onKey={onBack} />
        </box>
        {entries.length === 0 && (
          <FocusNavigable focus={() => undefined} focusNavigableId="empty">
            <text>No query history yet.</text>
          </FocusNavigable>
        )}
        {entries.map((entry, index) => (
          <FocusNavigable key={entry.id} focus={() => setSelectedIndex(index)} focusNavigableId={entryFocusId(entry.id)}>
            <HistoryRow active={index === selectedIndex} connectionName={connections.find((c) => c.id === entry.connectionId)?.name ?? ""} entry={entry} />
          </FocusNavigable>
        ))}
      </box>
    </FocusNavigableArea>
  )
}

function HistoryRow(props: { entry: QueryExecution; active: boolean; connectionName: string }) {
  const theme = useTheme()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const statusTag = props.entry.status !== "success" ? `[${props.entry.status}] ` : ""

  return (
    <box
      backgroundColor={navigationActive && highlighted ? theme.focusNavBg : (props.active ? theme.focusBg : undefined)}
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <text>{formatTime(props.entry.createdAt)}</text>
      <text flexGrow={1} flexShrink={1}>
        {statusTag}
        {truncateSql(props.entry.sql.source, 60)}
      </text>
      <text>{formatElapsed(props.entry)}</text>
      <text>{props.connectionName}</text>
    </box>
  )
}

function entryFocusId(id: string): string {
  return `entry-${id}`
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString()
}

function formatElapsed(entry: QueryExecution): string {
  if (!entry.finishedAt) return ""
  const ms = entry.finishedAt - entry.createdAt
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

function clamp(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

export const clampHistoryIndex = clamp
