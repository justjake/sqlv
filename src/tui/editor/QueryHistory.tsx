import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { sameFocusPath } from "../../lib/focus"
import type { QueryExecution } from "../../index"
import type { Connection } from "../../lib/types/Connection"
import type { SavedQuery } from "../../lib/types/SavedQuery"
import {
  Focusable,
  useFocusedDescendantPath,
  useFocusTree,
  useIsFocusNavigationActive,
  useIsFocusWithin,
  useRememberedDescendantPath,
} from "../focus"
import { Shortcut } from "../Shortcut"
import { QueryListTable, type TableColumn } from "../dataview/table"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

type QueryHistoryProps = {
  connections: Connection<any>[]
  entries: QueryExecution[]
  savedQueries: SavedQuery[]
  showSystemQueries: boolean
  onToggleShowSystemQueries: () => void
  onRestore: (entry: QueryFinderEntry) => void
  onBack: () => void
  width?: number
}

export type QueryFinderEntry =
  | {
      kind: "history"
      entry: QueryExecution
    }
  | {
      kind: "saved"
      savedQuery: SavedQuery
    }

export const QUERY_HISTORY_AREA_ID = "query-history"
const QUERY_HISTORY_FILTER_ID = "filter"
const QUERY_HISTORY_RESULTS_AREA_ID = "query-history-results"

type HistoryMatch = {
  kind: "history"
  connectionName: string
  entry: QueryExecution
  id: string
  index: number
  score: number
}

type SavedQueryMatch = {
  kind: "saved"
  id: string
  index: number
  lastExecution?: QueryExecution
  savedQuery: SavedQuery
  score: number
}

type QueryFinderMatch = HistoryMatch | SavedQueryMatch

export function QueryHistory(props: QueryHistoryProps) {
  const filterInputRef = useRef<InputRenderable>(null)
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  return (
    <Focusable
      autoFocus
      applyFocus={() => filterInputRef.current?.focus()}
      childrenNavigable={false}
      delegatesFocus
      focusable
      flexDirection="column"
      flexGrow={1}
      focusableId={QUERY_HISTORY_AREA_ID}
      position="relative"
    >
      <QueryHistoryBody {...props} filterInputRef={filterInputRef} scrollRef={scrollRef} />
    </Focusable>
  )
}

function QueryHistoryBody(
  props: QueryHistoryProps & {
    filterInputRef: RefObject<InputRenderable | null>
    scrollRef: RefObject<ScrollBoxRenderable | null>
  },
) {
  const {
    connections,
    entries,
    filterInputRef,
    onBack,
    onRestore,
    onToggleShowSystemQueries,
    savedQueries,
    scrollRef,
    showSystemQueries,
    width,
  } = props
  const [filterText, setFilterText] = useState("")
  const tree = useFocusTree()
  const theme = useTheme()
  const navigationActive = useIsFocusNavigationActive()
  const focusedWithin = useIsFocusWithin([QUERY_HISTORY_AREA_ID])
  const focusedDescendantPath = useFocusedDescendantPath()
  const rememberedDescendantPath = useRememberedDescendantPath()
  const visibleEntries = useMemo(
    () => (showSystemQueries ? entries : entries.filter((entry) => entry.initiator === "user")),
    [entries, showSystemQueries],
  )
  const filteredEntries = useMemo(
    () =>
      filterQueryFinderEntries({
        connections,
        entries: visibleEntries,
        filterText,
        savedQueries,
      }),
    [connections, filterText, savedQueries, visibleEntries],
  )
  const totalVisibleItemCount = visibleEntries.length + savedQueries.length

  useEffect(() => {
    if (!focusedWithin) {
      return
    }

    const interval = setInterval(() => {
      const nextText = filterInputRef.current?.value ?? ""
      setFilterText((current) => (current === nextText ? current : nextText))
    }, 30)

    return () => clearInterval(interval)
  }, [filterInputRef, focusedWithin])

  const selectedEntryId =
    resolveHistoryEntryId(focusedDescendantPath) ?? resolveHistoryEntryId(rememberedDescendantPath)
  const selectedIndex = filteredEntries.findIndex((match) => match.id === selectedEntryId)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
  const selectedEntry = filteredEntries[currentIndex]
  const columns = useMemo<Record<string, TableColumn<QueryFinderMatch>>>(
    () => ({
      status: {
        width: { absolute: 2 },
        Cell: ({ row }) => (
          <Text fg={finderStatusColor(row, theme)} wrapMode="none" truncate>
            {finderStatusGlyph(row)}
          </Text>
        ),
      },
      label: {
        width: { absolute: 12 },
        Cell: ({ row }) => (
          <Text fg={row.kind === "saved" ? theme.mutedFg : undefined} wrapMode="none" truncate>
            {finderLabel(row)}
          </Text>
        ),
      },
      primary: {
        width: { grow: 5 },
        Cell: ({ row }) =>
          row.kind === "saved" ? (
            <box flexDirection="row" gap={1}>
              <Text fg={theme.successFg} wrapMode="none" truncate>
                {truncateText(row.savedQuery.name, 22)}
              </Text>
              <Text flexGrow={1} flexShrink={1} fg={theme.mutedFg} wrapMode="none" truncate>
                {truncateSql(row.savedQuery.text, 100)}
              </Text>
            </box>
          ) : (
            <Text fg={row.entry.initiator === "system" ? theme.mutedFg : undefined} wrapMode="none" truncate>
              {truncateSql(row.entry.sql.source, 100)}
            </Text>
          ),
      },
      meta: {
        width: { absolute: 10 },
        Cell: ({ row }) => (
          <Text fg={theme.mutedFg} wrapMode="none" truncate>
            {row.kind === "saved" ? (row.savedQuery.protocol ?? "") : formatElapsed(row.entry)}
          </Text>
        ),
      },
      detail: {
        width: { grow: 2 },
        Cell: ({ row }) => (
          <Text fg={theme.mutedFg} wrapMode="none" truncate>
            {row.kind === "saved"
              ? row.lastExecution
                ? formatTime(row.lastExecution.createdAt)
                : ""
              : row.connectionName}
          </Text>
        ),
      },
    }),
    [theme],
  )
  const matchLabel =
    totalVisibleItemCount === 0
      ? "No previous or saved queries yet."
      : `${filteredEntries.length}/${totalVisibleItemCount} match${filteredEntries.length === 1 ? "" : "es"}`
  const shortcutsEnabled = focusedWithin && !navigationActive
  const canRestore = shortcutsEnabled && !!selectedEntry

  function focusRow(index: number) {
    const match = filteredEntries[index]
    if (!match) {
      return
    }
    tree.focusPath(historyEntryPath(match.id))
  }

  return (
    <box flexDirection="column" flexGrow={1} position="relative">
      <box flexDirection="row" flexShrink={0} flexWrap="wrap" gap={1}>
        <Shortcut keys="ctrl+r" label="Back" enabled={shortcutsEnabled} onKey={onBack} />
        <Shortcut
          keys={{ or: ["up", "k"] }}
          label="Prev"
          enabled={shortcutsEnabled && filteredEntries.length > 0}
          onKey={() => focusRow(Math.max(0, currentIndex - 1))}
        />
        <Shortcut
          keys={{ or: ["down", "j"] }}
          label="Next"
          enabled={shortcutsEnabled && filteredEntries.length > 0}
          onKey={() => focusRow(Math.min(filteredEntries.length - 1, currentIndex + 1))}
        />
        <Shortcut
          keys="return"
          label="Open"
          enabled={canRestore}
          onKey={() => {
            if (!selectedEntry) {
              return
            }
            onRestore(
              selectedEntry.kind === "history"
                ? { kind: "history", entry: selectedEntry.entry }
                : { kind: "saved", savedQuery: selectedEntry.savedQuery },
            )
          }}
        />
        <Shortcut
          keys="ctrl+g"
          label={showSystemQueries ? "Hide System" : "Show System"}
          enabled={shortcutsEnabled}
          onKey={onToggleShowSystemQueries}
        />
        <Shortcut keys="esc" label="Back" enabled={shortcutsEnabled} onKey={onBack} />
        <Text opacity={0.6}>{matchLabel}</Text>
        <Text opacity={0.6}>{showSystemQueries ? "[x] Show system queries" : "[ ] Show system queries"}</Text>
      </box>
      <Focusable focusable focusableId={QUERY_HISTORY_FILTER_ID} navigable={false}>
        <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} paddingRight={1}>
          <Text>Filter </Text>
          <box backgroundColor={theme.inputBg} flexGrow={1} height={1}>
            <input
              cursorColor={theme.primaryFg}
              ref={filterInputRef}
              flexGrow={1}
              focused={focusedWithin && !navigationActive}
              focusedTextColor={theme.primaryFg}
              placeholder="Type query name, SQL, or connection"
              placeholderColor={theme.mutedFg}
              textColor={theme.primaryFg}
              value={filterText}
            />
          </box>
        </box>
      </Focusable>
      <Focusable focusableId={QUERY_HISTORY_RESULTS_AREA_ID} flexDirection="column" flexGrow={1} scrollRef={scrollRef}>
        <scrollbox ref={scrollRef} flexGrow={1} contentOptions={{ flexDirection: "column" }}>
          {totalVisibleItemCount === 0 && (
            <box paddingLeft={1} paddingRight={1}>
              <Text>No previous or saved queries yet.</Text>
            </box>
          )}
          {totalVisibleItemCount > 0 && filteredEntries.length === 0 && (
            <box paddingLeft={1} paddingRight={1}>
              <Text>No matches for "{filterText.trim()}".</Text>
            </box>
          )}
          {filteredEntries.length > 0 && (
            <QueryListTable
              rows={filteredEntries}
              columns={columns}
              width={width}
              getRowKey={(row) => row.id}
              getRowFocusableId={(row) => entryFocusId(row.id)}
              isRowDimmed={(row) => row.kind === "history" && row.entry.initiator === "system"}
              isRowFocused={(row) => sameFocusPath(historyEntryPath(row.id), focusedDescendantPath)}
              isRowSelected={(row) =>
                !focusedWithin && sameFocusPath(historyEntryPath(row.id), rememberedDescendantPath)
              }
            />
          )}
        </scrollbox>
      </Focusable>
    </box>
  )
}

function entryFocusId(id: string): string {
  return `entry-${id}`
}

function historyEntryPath(id: string): readonly [string, string, string] {
  return [QUERY_HISTORY_AREA_ID, QUERY_HISTORY_RESULTS_AREA_ID, entryFocusId(id)]
}

function resolveHistoryEntryId(path: readonly string[] | undefined): string | undefined {
  const entryId = path?.[2]
  if (
    !path ||
    path.length !== 3 ||
    path[0] !== QUERY_HISTORY_AREA_ID ||
    path[1] !== QUERY_HISTORY_RESULTS_AREA_ID ||
    !entryId?.startsWith("entry-")
  ) {
    return undefined
  }

  return entryId.slice("entry-".length)
}

function filterQueryFinderEntries(args: {
  connections: Connection<any>[]
  entries: QueryExecution[]
  filterText: string
  savedQueries: SavedQuery[]
}): QueryFinderMatch[] {
  const { connections, entries, filterText, savedQueries } = args
  const connectionNames = new Map(connections.map((connection) => [connection.id, connection.name]))
  const tokens = tokenizeFilter(filterText)
  const historyMatches: HistoryMatch[] = []
  for (const [index, entry] of entries.entries()) {
    const connectionName = connectionNames.get(entry.connectionId) ?? ""

    if (tokens.length === 0) {
      historyMatches.push({
        kind: "history",
        connectionName,
        entry,
        id: finderItemId("history", entry.id),
        index,
        score: 0,
      } satisfies HistoryMatch)
      continue
    }

    let score = 0
    let excluded = false
    for (const token of tokens) {
      const tokenScore = scoreHistoryToken(token, entry, connectionName)
      if (tokenScore === undefined) {
        excluded = true
        break
      }
      score += tokenScore
    }

    if (excluded) {
      continue
    }

    historyMatches.push({
      kind: "history",
      connectionName,
      entry,
      id: finderItemId("history", entry.id),
      index,
      score,
    } satisfies HistoryMatch)
  }

  const savedMatches: SavedQueryMatch[] = []
  for (const [index, savedQuery] of savedQueries.entries()) {
    const lastExecution = findLatestSavedQueryExecution(savedQuery, entries, connections)

    if (tokens.length === 0) {
      savedMatches.push({
        kind: "saved",
        id: finderItemId("saved", savedQuery.id),
        index,
        lastExecution,
        savedQuery,
        score: 0,
      } satisfies SavedQueryMatch)
      continue
    }

    let score = 0
    let excluded = false
    for (const token of tokens) {
      const tokenScore = scoreSavedQueryToken(token, savedQuery)
      if (tokenScore === undefined) {
        excluded = true
        break
      }
      score += tokenScore
    }

    if (excluded) {
      continue
    }

    savedMatches.push({
      kind: "saved",
      id: finderItemId("saved", savedQuery.id),
      index,
      lastExecution,
      savedQuery,
      score,
    } satisfies SavedQueryMatch)
  }

  return [...historyMatches, ...savedMatches].sort((a, b) => {
    if (tokens.length === 0) {
      return (a.kind === "history" ? 0 : 1) - (b.kind === "history" ? 0 : 1) || a.index - b.index
    }
    return b.score - a.score || (a.kind === "saved" ? 0 : 1) - (b.kind === "saved" ? 0 : 1) || a.index - b.index
  })
}

function finderItemId(kind: QueryFinderMatch["kind"], id: string): string {
  return `${kind}:${id}`
}

function findLatestSavedQueryExecution(
  savedQuery: SavedQuery,
  entries: QueryExecution[],
  connections: Connection<any>[],
): QueryExecution | undefined {
  const protocolByConnectionId = new Map(connections.map((connection) => [connection.id, connection.protocol]))

  return (
    entries.find((entry) => entry.savedQueryId === savedQuery.id) ??
    entries.find(
      (entry) =>
        entry.sql.source === savedQuery.text &&
        (savedQuery.protocol === undefined || protocolByConnectionId.get(entry.connectionId) === savedQuery.protocol),
    )
  )
}

function tokenizeFilter(value: string): string[] {
  const normalized = normalizeSearchText(value)
  return normalized ? normalized.split(" ") : []
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function scoreHistoryToken(token: string, entry: QueryExecution, connectionName: string): number | undefined {
  return maxScore(
    scoreSearchToken(token, normalizeSearchText(entry.sql.source), { exactBase: 240, fuzzyBase: 80 }),
    scoreSearchToken(token, normalizeSearchText(connectionName), { exactBase: 140, fuzzyBase: 40 }),
  )
}

function scoreSavedQueryToken(token: string, savedQuery: SavedQuery): number | undefined {
  return maxScore(
    scoreSearchToken(token, normalizeSearchText(savedQuery.name), { exactBase: 600, fuzzyBase: 320 }),
    scoreSearchToken(token, normalizeSearchText(savedQuery.text), { exactBase: 220, fuzzyBase: 80 }),
    scoreSearchToken(token, normalizeSearchText(savedQuery.protocol ?? ""), { exactBase: 160, fuzzyBase: 40 }),
  )
}

function maxScore(...scores: Array<number | undefined>): number | undefined {
  let best: number | undefined
  for (const score of scores) {
    if (score === undefined) {
      continue
    }
    best = best === undefined ? score : Math.max(best, score)
  }
  return best
}

function scoreSearchToken(
  token: string,
  haystack: string,
  weights: {
    exactBase: number
    fuzzyBase: number
  },
): number | undefined {
  if (!haystack) {
    return undefined
  }

  const exactMatchIndex = haystack.indexOf(token)
  if (exactMatchIndex !== -1) {
    return Math.max(1, weights.exactBase - exactMatchIndex)
  }

  let bestScore: number | undefined
  for (const word of haystack.split(" ").filter(Boolean)) {
    const wordScore = fuzzyScore(token, word)
    if (wordScore === undefined) {
      continue
    }
    bestScore = bestScore === undefined ? wordScore : Math.max(bestScore, wordScore)
  }

  return bestScore === undefined ? undefined : weights.fuzzyBase + bestScore
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

function truncateText(value: string, max: number): string {
  if (value.length <= max) {
    return value
  }
  return value.slice(0, max) + "..."
}

function finderLabel(row: QueryFinderMatch): string {
  return row.kind === "saved" ? "saved" : formatTime(row.entry.createdAt)
}

function finderStatusGlyph(row: QueryFinderMatch): string {
  if (row.kind === "saved") {
    return row.lastExecution ? historyStatusGlyph(row.lastExecution) : "◦"
  }
  return historyStatusGlyph(row.entry)
}

function finderStatusColor(row: QueryFinderMatch, theme: ReturnType<typeof useTheme>): string {
  if (row.kind === "saved") {
    return row.lastExecution ? historyStatusColor(row.lastExecution, theme) : theme.mutedFg
  }
  return historyStatusColor(row.entry, theme)
}

function historyStatusGlyph(entry: QueryExecution): string {
  switch (entry.status) {
    case "success":
      return "✓"
    case "error":
      return "×"
    case "cancelled":
      return "-"
    case "pending":
      return "…"
  }
}

function historyStatusColor(entry: QueryExecution, theme: ReturnType<typeof useTheme>): string {
  switch (entry.status) {
    case "success":
      return theme.successFg
    case "error":
      return theme.errorFg
    case "cancelled":
      return theme.mutedFg
    case "pending":
      return theme.warningFg
  }
}

function clamp(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

export const clampHistoryIndex = clamp
