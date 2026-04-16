import type { BoxRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useMemo, useRef, useState, type ReactNode } from "react"

import { focusPath, focusPathKey } from "../../framework/focus/paths"
import {
  useFocusedDescendantPath,
  useFocusTree,
  useIsFocusNavigationActive,
  useIsFocused,
  useIsFocusWithin,
  useRememberedDescendantPath,
} from "../focus/context"
import { Focusable } from "../focus/Focusable"
import { useOpaqueIdMap } from "../focus/opaqueIds"
import { useNavKeys } from "../ui/keybind/useNavKeys"
import { useShortcut } from "../ui/keybind/useShortcut"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

import { Table, type TableColumn } from "./table/Table"

type CellCoordinates = {
  rowIndex: number
  columnIndex: number
}

type DisplayRow = Record<string, string>

export const RESULTS_TABLE_FOCUS_ID = "results-table"
export const RESULTS_TABLE_GRID_AREA_ID = "grid"
const RESULTS_TABLE_GRID_PATH = [RESULTS_TABLE_FOCUS_ID, RESULTS_TABLE_GRID_AREA_ID] as const

export function ResultsTable(props: { rows: object[]; width?: number }) {
  return (
    <Focusable
      childrenNavigable={false}
      delegatesFocus
      flexGrow={1}
      focusSelf
      focusable
      flexDirection="column"
      focusableId={RESULTS_TABLE_FOCUS_ID}
      position="relative"
    >
      <ResultsTableBody {...props} />
    </Focusable>
  )
}

function ResultsTableBody(props: { rows: object[]; width?: number }) {
  const { rows, width } = props
  const theme = useTheme()
  const tree = useFocusTree()
  const { width: terminalWidth } = useTerminalDimensions()
  const containerRef = useRef<BoxRenderable>(null)
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(width)
  const navigationActive = useIsFocusNavigationActive()
  const focusedWithin = useIsFocusWithin([RESULTS_TABLE_FOCUS_ID])
  const focusedCellPath = useFocusedDescendantPath()
  const rememberedCellPath = useRememberedDescendantPath()

  const records = rows as Record<string, unknown>[]

  const columnKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of records) {
      for (const key of Object.keys(row)) keys.add(key)
    }
    return [...keys]
  }, [records])

  const displayRows = useMemo<DisplayRow[]>(() => {
    return records.map((row) => {
      const values: DisplayRow = {}
      for (const key of columnKeys) {
        values[key] = formatValue(row[key])
      }
      return values
    })
  }, [columnKeys, records])
  const viewportWidth = width ?? measuredWidth ?? terminalWidth
  const preferredColumnWidths = useMemo(() => {
    return columnKeys.map((key) => preferredWidthForColumn(key, displayRows))
  }, [columnKeys, displayRows])
  const preferredTableWidth = useMemo(() => {
    if (preferredColumnWidths.length === 0) {
      return viewportWidth
    }
    return (
      preferredColumnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
      Math.max(0, preferredColumnWidths.length - 1)
    )
  }, [preferredColumnWidths, viewportWidth])
  const shouldScroll = preferredTableWidth > viewportWidth
  const tableWidth = shouldScroll ? preferredTableWidth : viewportWidth
  const rowKeys = useMemo(() => rows.map((_row, rowIndex) => rowIndex), [rows])
  const rowFocusIds = useOpaqueIdMap(rowKeys, "row")
  const columnFocusIds = useOpaqueIdMap(columnKeys, "cell")
  const cellCoordinatesByPathKey = useMemo(() => {
    const next = new Map<string, CellCoordinates>()
    for (const rowIndex of rowKeys) {
      const rowFocusId = rowFocusIds.get(rowIndex)
      if (!rowFocusId) {
        continue
      }

      const rowPath = focusPath(RESULTS_TABLE_GRID_PATH, rowFocusId)
      for (const [columnIndex, columnKey] of columnKeys.entries()) {
        const columnFocusId = columnFocusIds.get(columnKey)
        if (!columnFocusId) {
          continue
        }

        const cellPath = focusPath(rowPath, columnFocusId)
        const cellPathKey = focusPathKey(cellPath)
        if (cellPathKey) {
          next.set(cellPathKey, { rowIndex, columnIndex })
        }
      }
    }
    return next
  }, [columnFocusIds, columnKeys, rowFocusIds, rowKeys])

  const cellCount = rows.length * columnKeys.length
  const activeCell = useMemo(
    () => resolveFocusedCellCoordinates(focusedCellPath, cellCoordinatesByPathKey),
    [cellCoordinatesByPathKey, focusedCellPath],
  )
  const rememberedCell = useMemo(
    () => resolveFocusedCellCoordinates(rememberedCellPath, cellCoordinatesByPathKey),
    [cellCoordinatesByPathKey, rememberedCellPath],
  )

  function focusCell(coords: CellCoordinates): boolean {
    if (cellCount === 0) {
      return false
    }

    const next = clampCellCoordinates(coords, rows.length, columnKeys.length)
    const nextPath = resultsTableCellPath(next.rowIndex, next.columnIndex, columnKeys, rowFocusIds, columnFocusIds)
    return nextPath ? tree.focusPath(nextPath) : false
  }

  const focusCellRef = useRef(focusCell)
  focusCellRef.current = focusCell

  const shortcutsEnabled = !navigationActive && focusedWithin && rows.length > 0 && columnKeys.length > 0

  function currentCell(): CellCoordinates {
    return activeCell ?? { rowIndex: 0, columnIndex: 0 }
  }

  function focusNextCell(key: KeyEvent, coords: CellCoordinates) {
    key.preventDefault()
    key.stopPropagation()
    void focusCellRef.current(coords)
  }

  function moveBy(key: KeyEvent, rowOffset: number, columnOffset: number) {
    const current = currentCell()
    focusNextCell(key, {
      rowIndex: current.rowIndex + rowOffset,
      columnIndex: current.columnIndex + columnOffset,
    })
  }

  function moveTo(key: KeyEvent, coords: CellCoordinates) {
    focusNextCell(key, coords)
  }

  useNavKeys({
    enabled: shortcutsEnabled,
    handlers: {
      "command+down"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: rows.length - 1, columnIndex: current.columnIndex })
      },
      "command+left"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: current.rowIndex, columnIndex: 0 })
      },
      "command+right"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: current.rowIndex, columnIndex: columnKeys.length - 1 })
      },
      "command+up"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: 0, columnIndex: current.columnIndex })
      },
      "ctrl+down"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: rows.length - 1, columnIndex: current.columnIndex })
      },
      "ctrl+left"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: current.rowIndex, columnIndex: 0 })
      },
      "ctrl+right"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: current.rowIndex, columnIndex: columnKeys.length - 1 })
      },
      "ctrl+up"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: 0, columnIndex: current.columnIndex })
      },
      down(key) {
        moveBy(key, 1, 0)
      },
      left(key) {
        moveBy(key, 0, -1)
      },
      "option+down"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: rows.length - 1, columnIndex: current.columnIndex })
      },
      "option+left"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: current.rowIndex, columnIndex: 0 })
      },
      "option+right"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: current.rowIndex, columnIndex: columnKeys.length - 1 })
      },
      "option+up"(key) {
        const current = currentCell()
        moveTo(key, { rowIndex: 0, columnIndex: current.columnIndex })
      },
      right(key) {
        moveBy(key, 0, 1)
      },
      up(key) {
        moveBy(key, -1, 0)
      },
    },
  })

  useShortcut({
    enabled: shortcutsEnabled,
    keys: { or: ["tab", "shift+tab"] },
    onKey(key) {
      moveBy(key, 0, key.shift ? -1 : 1)
    },
  })

  useShortcut({
    enabled: shortcutsEnabled,
    keys: { or: ["return", "shift+return"] },
    onKey(key) {
      moveBy(key, key.shift ? -1 : 1, 0)
    },
  })

  useShortcut({
    enabled: shortcutsEnabled,
    keys: "home",
    onKey(key) {
      const current = currentCell()
      moveTo(key, { rowIndex: current.rowIndex, columnIndex: 0 })
    },
  })

  useShortcut({
    enabled: shortcutsEnabled,
    keys: "end",
    onKey(key) {
      const current = currentCell()
      moveTo(key, { rowIndex: current.rowIndex, columnIndex: columnKeys.length - 1 })
    },
  })

  useShortcut({
    enabled: shortcutsEnabled,
    keys: { or: ["ctrl+home", "option+home", "command+home"] },
    onKey(key) {
      moveTo(key, { rowIndex: 0, columnIndex: 0 })
    },
  })

  useShortcut({
    enabled: shortcutsEnabled,
    keys: { or: ["ctrl+end", "option+end", "command+end"] },
    onKey(key) {
      moveTo(key, { rowIndex: rows.length - 1, columnIndex: columnKeys.length - 1 })
    },
  })

  const columns = useMemo(() => {
    const cols: Record<string, TableColumn<object>> = {}
    for (const [columnIndex, key] of columnKeys.entries()) {
      const maxContentWidth = Math.max(key.length, ...displayRows.map((row) => row[key]!.length))
      cols[key] = {
        width: shouldScroll
          ? { absolute: preferredColumnWidths[columnIndex] ?? 1 }
          : { grow: growWidthForColumn(maxContentWidth) },
        Header: () => (
          <Text wrapMode="none" truncate>
            {" " + key}
          </Text>
        ),
        Cell: ({ rowIndex, columnWidth }) => (
          <ResultsCell
            columnWidth={columnWidth}
            focusableId={requiredOpaqueFocusId(columnFocusIds, key)}
            remembered={!focusedWithin && sameCellCoordinates(rememberedCell, rowIndex, columnIndex)}
            value={displayRows[rowIndex]?.[key] ?? ""}
          />
        ),
      }
    }
    return cols
  }, [columnFocusIds, columnKeys, displayRows, focusedWithin, preferredColumnWidths, rememberedCell, shouldScroll])

  if (rows.length === 0) return <Text>No results.</Text>

  function handleSizeChange() {
    const nextWidth = containerRef.current?.width
    if (!nextWidth) {
      return
    }
    setMeasuredWidth((current) => (current === nextWidth ? current : nextWidth))
  }

  return (
    <box
      ref={containerRef}
      flexDirection="column"
      flexGrow={1}
      onSizeChange={handleSizeChange}
      position="relative"
      width={width ?? "100%"}
    >
      <Focusable flexDirection="column" flexGrow={1} focusableId={RESULTS_TABLE_GRID_AREA_ID} scrollRef={scrollRef}>
        <scrollbox ref={scrollRef} flexGrow={1} scrollX={shouldScroll} contentOptions={{ flexDirection: "column" }}>
          <Table
            rows={rows}
            columns={columns}
            width={tableWidth}
            headerBg={theme.inputBg}
            borderColor={theme.borderColor}
            wrapRow={({ rowIndex, children }) => {
              const rowFocusId = rowFocusIds.get(rowIndex)
              if (!rowFocusId) {
                return <box width="100%">{children}</box>
              }

              return <ResultsRow rowFocusableId={rowFocusId}>{children}</ResultsRow>
            }}
          />
        </scrollbox>
      </Focusable>
    </box>
  )
}

function ResultsRow(props: { rowFocusableId: string; children: ReactNode }) {
  return (
    <Focusable
      focusableId={props.rowFocusableId}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      position="relative"
      width="100%"
    >
      <box position="relative" width="100%">
        {props.children}
      </box>
    </Focusable>
  )
}

function ResultsCell(props: { columnWidth: number; focusableId: string; remembered: boolean; value: string }) {
  const { columnWidth, focusableId, remembered, value } = props
  const theme = useTheme()
  const focused = useIsFocused()
  const navigationActive = useIsFocusNavigationActive()
  const showPopout = focused && !navigationActive && shouldPopOut(value, columnWidth)

  return (
    <Focusable
      focusable
      focusableId={focusableId}
      height={1}
      navigable={false}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      position="relative"
      width="100%"
    >
      <box
        backgroundColor={focused ? theme.focusBg : remembered ? theme.inputBg : undefined}
        position="relative"
        width="100%"
      >
        <Text wrapMode="none" truncate>
          {" " + value}
        </Text>
        {showPopout && (
          <box
            backgroundColor={theme.focusHintBg}
            border
            borderColor={theme.borderColor}
            left={0}
            position="absolute"
            top={1}
            width="100%"
            zIndex={2}
          >
            <Text wrapMode={resolvePopOutWrapMode(value)}>{" " + value}</Text>
          </box>
        )}
      </box>
    </Focusable>
  )
}

function clampCellCoordinates(coords: CellCoordinates, rowCount: number, columnCount: number): CellCoordinates {
  return {
    rowIndex: clamp(coords.rowIndex, rowCount),
    columnIndex: clamp(coords.columnIndex, columnCount),
  }
}

function clamp(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

function resultsTableCellPath(
  rowIndex: number,
  columnIndex: number,
  columnKeys: readonly string[],
  rowFocusIds: ReadonlyMap<number, string>,
  columnFocusIds: ReadonlyMap<string, string>,
): readonly string[] | undefined {
  const rowFocusId = rowFocusIds.get(rowIndex)
  const columnKey = columnKeys[columnIndex]
  const columnFocusId = columnKey === undefined ? undefined : columnFocusIds.get(columnKey)
  if (!rowFocusId || !columnFocusId) {
    return undefined
  }

  return focusPath(focusPath(RESULTS_TABLE_GRID_PATH, rowFocusId), columnFocusId)
}

function resolveFocusedCellCoordinates(
  path: readonly string[] | undefined,
  coordinatesByPathKey: ReadonlyMap<string, CellCoordinates>,
): CellCoordinates | undefined {
  const pathKey = focusPathKey(path)
  return pathKey ? coordinatesByPathKey.get(pathKey) : undefined
}

function sameCellCoordinates(coords: CellCoordinates | undefined, rowIndex: number, columnIndex: number): boolean {
  return coords !== undefined && coords.rowIndex === rowIndex && coords.columnIndex === columnIndex
}

function formatValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function growWidthForColumn(maxContentWidth: number): number {
  if (maxContentWidth <= 8) return 1
  if (maxContentWidth <= 16) return 2
  if (maxContentWidth <= 32) return 3
  if (maxContentWidth <= 64) return 4
  return 5
}

function preferredWidthForColumn(column: string, rows: DisplayRow[]): number {
  const maxContentWidth = Math.max(column.length, ...rows.map((row) => row[column]!.length))
  return Math.max(4, Math.min(maxContentWidth + 1, 32))
}

function shouldPopOut(value: string, columnWidth: number): boolean {
  return value.length + 1 > columnWidth || value.includes("\n")
}

function resolvePopOutWrapMode(value: string): "char" | "word" | "none" {
  return /\s/.test(value) ? "word" : "char"
}

function requiredOpaqueFocusId<Key extends string | number>(ids: ReadonlyMap<Key, string>, key: Key): string {
  const focusableId = ids.get(key)
  if (!focusableId) {
    throw new Error(`Missing focusable id for ${String(key)}`)
  }
  return focusableId
}
