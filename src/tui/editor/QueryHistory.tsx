import type { InputRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { QueryExecution } from "../../index"
import type { Connection } from "../../lib/types/Connection"
import {
  FocusHalo,
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
const QUERY_HISTORY_RESULTS_AREA_ID = "query-history-results"

type HistoryMatch = {
  entry: QueryExecution
  connectionName: string
  index: number
  score: number
}

export function QueryHistory(props: QueryHistoryProps) {
  const { connections, entries, onRestore, onBack } = props
  const [filterText, setFilterText] = useState("")
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>(entries[0]?.id)
  const tree = useFocusTree()
  const theme = useTheme()
  const filterInputRef = useRef<InputRenderable>(null)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const navigationActive = useIsFocusNavigationActive()
  const focusedWithin = useIsFocusWithin([QUERY_HISTORY_AREA_ID])
  const filteredEntries = useMemo(
    () => filterHistoryEntries(entries, connections, filterText),
    [connections, entries, filterText],
  )

  useEffect(() => {
    setSelectedEntryId((current) => {
      if (current && filteredEntries.some((match) => match.entry.id === current)) {
        return current
      }
      return filteredEntries[0]?.entry.id
    })
  }, [filteredEntries])

  useEffect(() => {
    if (!focusedWithin) {
      return
    }

    const interval = setInterval(() => {
      const nextText = filterInputRef.current?.value ?? ""
      setFilterText((current) => (current === nextText ? current : nextText))
    }, 30)

    return () => clearInterval(interval)
  }, [focusedWithin])

  useEffect(() => {
    if (filteredEntries.length > 0 || !focusedWithin) {
      return
    }

    queueMicrotask(() => {
      tree.setFocusedPath([QUERY_HISTORY_AREA_ID])
    })
  }, [filteredEntries.length, focusedWithin, tree])

  const selectedIndex = filteredEntries.findIndex((match) => match.entry.id === selectedEntryId)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
  const selectedEntry = filteredEntries[currentIndex]?.entry
  const matchLabel =
    entries.length === 0 ? "No previous queries yet." : `${filteredEntries.length}/${entries.length} match${filteredEntries.length === 1 ? "" : "es"}`

  function focusRow(index: number) {
    const match = filteredEntries[index]
    if (!match) {
      return
    }
    setSelectedEntryId(match.entry.id)
    tree.focusPath(historyEntryPath(match.entry.id))
  }

  useKeyboard((key) => {
    if (navigationActive || !focusedWithin) {
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
        focusRow(Math.min(filteredEntries.length - 1, currentIndex + 1))
        return
      case "enter":
      case "return":
        key.preventDefault()
        key.stopPropagation()
        if (selectedEntry) {
          onRestore(selectedEntry)
        }
        return
      case "escape":
        key.preventDefault()
        key.stopPropagation()
        onBack()
        return
    }

    if (shouldSyncFilterText(key)) {
      setTimeout(() => {
        setFilterText(filterInputRef.current?.value ?? "")
      }, 0)
    }
  })

  return (
    <FocusNavigable
      autoFocus
      flexDirection="column"
      flexGrow={1}
      focus={() => filterInputRef.current?.focus()}
      focusNavigableId={QUERY_HISTORY_AREA_ID}
      position="relative"
    >
      <box flexDirection="column" flexGrow={1} position="relative">
        <box flexDirection="row" flexShrink={0} gap={1}>
          <Shortcut keys="ctrl+r" label="Back" enabled onKey={onBack} />
        </box>
        <box
          backgroundColor={theme.inputBg}
          flexDirection="row"
          flexShrink={0}
          gap={1}
          paddingLeft={1}
          paddingRight={1}
        >
          <text>Query Finder</text>
          <text opacity={0.6}>{matchLabel}</text>
          {entries.length > 0 && <text opacity={0.6}>type filter</text>}
          {filteredEntries.length > 0 && <text opacity={0.6}>up/down select</text>}
          {filteredEntries.length > 0 && <text opacity={0.6}>enter restore</text>}
          <text opacity={0.6}>esc back</text>
        </box>
        <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} paddingRight={1}>
          <text>Filter </text>
          <box backgroundColor={theme.inputBg} flexGrow={1} height={1}>
            <input
              ref={filterInputRef}
              flexGrow={1}
              focused={focusedWithin && !navigationActive}
              placeholder="Type SQL or connection name"
              value={filterText}
            />
          </box>
        </box>
        <FocusNavigableArea
          flexDirection="column"
          flexGrow={1}
          focusNavigableId={QUERY_HISTORY_RESULTS_AREA_ID}
          scrollRef={scrollRef}
        >
          <scrollbox ref={scrollRef} flexGrow={1} contentOptions={{ flexDirection: "column" }}>
            {entries.length === 0 && (
              <box paddingLeft={1} paddingRight={1}>
                <text>No previous queries yet.</text>
              </box>
            )}
            {entries.length > 0 && filteredEntries.length === 0 && (
              <box paddingLeft={1} paddingRight={1}>
                <text>No matches for "{filterText.trim()}".</text>
              </box>
            )}
            {filteredEntries.map((match, index) => (
              <FocusNavigable
                key={match.entry.id}
                focus={() => setSelectedEntryId(match.entry.id)}
                focusNavigableId={entryFocusId(match.entry.id)}
              >
                <HistoryRow
                  active={index === currentIndex}
                  connectionName={match.connectionName}
                  entry={match.entry}
                />
              </FocusNavigable>
            ))}
          </scrollbox>
        </FocusNavigableArea>
        <FocusHalo />
      </box>
    </FocusNavigable>
  )
}

function HistoryRow(props: { entry: QueryExecution; active: boolean; connectionName: string }) {
  const theme = useTheme()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()

  return (
    <box
      backgroundColor={navigationActive && highlighted ? theme.focusNavBg : (props.active ? theme.focusBg : undefined)}
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <text>{formatTime(props.entry.createdAt)}</text>
      <text fg={theme.mutedFg}>{historyStatusLabel(props.entry)}</text>
      <text flexGrow={1} flexShrink={1}>
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

function historyEntryPath(id: string): readonly [string, string, string] {
  return [QUERY_HISTORY_AREA_ID, QUERY_HISTORY_RESULTS_AREA_ID, entryFocusId(id)]
}

function filterHistoryEntries(
  entries: QueryExecution[],
  connections: Connection<any>[],
  filterText: string,
): HistoryMatch[] {
  const connectionNames = new Map(connections.map((connection) => [connection.id, connection.name]))
  const tokens = tokenizeFilter(filterText)
  const matches = entries.map((entry, index) => {
    const connectionName = connectionNames.get(entry.connectionId) ?? ""

    if (tokens.length === 0) {
      return {
        connectionName,
        entry,
        index,
        score: 0,
      } satisfies HistoryMatch
    }

    const haystack = normalizeSearchText(`${entry.sql.source} ${connectionName}`)
    const words = haystack.split(" ").filter(Boolean)
    let score = 0

    for (const token of tokens) {
      const tokenScore = scoreHistoryToken(token, haystack, words)
      if (tokenScore === undefined) {
        return undefined
      }
      score += tokenScore
    }

    return {
      connectionName,
      entry,
      index,
      score,
    } satisfies HistoryMatch
  })

  return matches
    .filter((match): match is HistoryMatch => match !== undefined)
    .sort((a, b) => {
      if (tokens.length === 0) {
        return a.index - b.index
      }
      return b.score - a.score || a.index - b.index
    })
}

function tokenizeFilter(value: string): string[] {
  const normalized = normalizeSearchText(value)
  return normalized ? normalized.split(" ") : []
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function scoreHistoryToken(token: string, haystack: string, words: string[]): number | undefined {
  const exactMatchIndex = haystack.indexOf(token)
  if (exactMatchIndex !== -1) {
    return 100 - exactMatchIndex
  }

  let bestScore: number | undefined
  for (const word of words) {
    const wordScore = fuzzyScore(token, word)
    if (wordScore === undefined) {
      continue
    }
    bestScore = bestScore === undefined ? wordScore : Math.max(bestScore, wordScore)
  }

  return bestScore
}

function fuzzyScore(needle: string, haystack: string): number | undefined {
  if (!needle) {
    return 0
  }

  let score = 0
  let lastIndex = -1
  let streak = 0

  for (const char of needle) {
    const index = haystack.indexOf(char, lastIndex + 1)
    if (index === -1) {
      return undefined
    }

    const gap = lastIndex === -1 ? index : index - lastIndex - 1
    if (gap === 0) {
      streak += 1
      score += 8 + streak * 2
    } else {
      streak = 0
      score += Math.max(1, 6 - gap)
    }

    if (index === 0 || isWordBoundary(haystack.charAt(index - 1))) {
      score += 5
    }

    lastIndex = index
  }

  return score - Math.max(0, haystack.length - needle.length)
}

function isWordBoundary(char: string): boolean {
  return char === " " || char === "_" || char === "-" || char === "." || char === "/"
}

function shouldSyncFilterText(key: KeyEvent): boolean {
  return printableKeyText(key) !== undefined || key.name === "backspace" || key.name === "delete"
}

function printableKeyText(key: KeyEvent): string | undefined {
  if (key.ctrl || key.meta || key.option) {
    return undefined
  }

  if (key.name === "space") {
    return " "
  }

  if (!key.sequence || key.sequence.length !== 1) {
    return undefined
  }

  const code = key.sequence.charCodeAt(0)
  if (code < 32 || code === 127) {
    return undefined
  }

  return key.sequence
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

function historyStatusLabel(entry: QueryExecution): string {
  switch (entry.status) {
    case "success":
      return "[done]"
    case "error":
      return "[error]"
    case "cancelled":
      return "[cancelled]"
    case "pending":
      return "[running]"
  }
}

function clamp(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

export const clampHistoryIndex = clamp
