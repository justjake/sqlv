import type { BoxRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useMemo, useRef, useState, type ReactNode } from "react"
import {
  FocusHalo,
  Focusable,
  useFocusedDescendantPath,
  useIsFocusNavigationActive,
  useIsFocused,
  useIsFocusWithin,
  useRememberedDescendantPath,
  useFocusTree,
} from "../focus"
import { useKeybindHandler } from "../ui/keybind"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"
import { Table, type TableColumn } from "./table"

type CellCoordinates = {
  rowIndex: number
  columnIndex: number
}

type DisplayRow = Record<string, string>

export const RESULTS_TABLE_FOCUS_ID = "results-table"
export const RESULTS_TABLE_GRID_AREA_ID = "grid"

export function resultsTableRowFocusId(rowIndex: number): string {
  return `row-${rowIndex}`
}

export function resultsTableCellFocusId(columnIndex: number): string {
  return `cell-${columnIndex}`
}

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
    return preferredColumnWidths.reduce((sum, columnWidth) => sum + columnWidth, 0) + Math.max(0, preferredColumnWidths.length - 1)
  }, [preferredColumnWidths, viewportWidth])
  const shouldScroll = preferredTableWidth > viewportWidth
  const tableWidth = shouldScroll ? preferredTableWidth : viewportWidth
  const rowIndexById = useMemo(() => {
    const next = new Map<string, number>()
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      next.set(resultsTableRowFocusId(rowIndex), rowIndex)
    }
    return next
  }, [rows.length])
  const columnIndexById = useMemo(() => {
    const next = new Map<string, number>()
    for (let columnIndex = 0; columnIndex < columnKeys.length; columnIndex += 1) {
      next.set(resultsTableCellFocusId(columnIndex), columnIndex)
    }
    return next
  }, [columnKeys.length])

  const cellCount = rows.length * columnKeys.length
  const activeCell = useMemo(
    () => resolveFocusedCellCoordinates(focusedCellPath, rowIndexById, columnIndexById),
    [columnIndexById, focusedCellPath, rowIndexById],
  )
  const rememberedCell = useMemo(
    () => resolveFocusedCellCoordinates(rememberedCellPath, rowIndexById, columnIndexById),
    [columnIndexById, rememberedCellPath, rowIndexById],
  )

  function focusCell(coords: CellCoordinates): boolean {
    if (cellCount === 0) {
      return false
    }

    const next = clampCellCoordinates(coords, rows.length, columnKeys.length)
    return tree.focusPath(resultsTableCellPath(next.rowIndex, next.columnIndex))
  }

  const focusCellRef = useRef(focusCell)
  focusCellRef.current = focusCell

  useKeybindHandler({
    enabled: !navigationActive && focusedWithin && rows.length > 0 && columnKeys.length > 0,
    onKey(key: KeyEvent) {
      const current = activeCell ?? { rowIndex: 0, columnIndex: 0 }
      const next = navigateResultsGrid(key, current, rows.length, columnKeys.length)
      if (!next) {
        return
      }

      key.preventDefault()
      key.stopPropagation()
      void focusCellRef.current(next)
    },
  })

  const columns = useMemo(() => {
    const cols: Record<string, TableColumn<object>> = {}
    for (const [columnIndex, key] of columnKeys.entries()) {
      const maxContentWidth = Math.max(key.length, ...displayRows.map((row) => row[key]!.length))
      cols[key] = {
        width: shouldScroll ? { absolute: preferredColumnWidths[columnIndex] ?? 1 } : { grow: growWidthForColumn(maxContentWidth) },
        Header: () => <Text wrapMode="none" truncate>{" " + key}</Text>,
        Cell: ({ rowIndex, columnWidth }) => (
          <ResultsCell
            columnIndex={columnIndex}
            columnWidth={columnWidth}
            remembered={!focusedWithin && sameCellCoordinates(rememberedCell, rowIndex, columnIndex)}
            value={displayRows[rowIndex]?.[key] ?? ""}
          />
        ),
      }
    }
    return cols
  }, [columnKeys, displayRows, focusedWithin, preferredColumnWidths, rememberedCell, shouldScroll])

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
            wrapRow={({ rowIndex, children }) => (
              <ResultsRow rowIndex={rowIndex}>
                {children}
              </ResultsRow>
            )}
          />
        </scrollbox>
      </Focusable>
      <FocusHalo />
    </box>
  )
}

function ResultsRow(props: {
  rowIndex: number
  children: ReactNode
}) {
  return (
    <Focusable
      focusableId={resultsTableRowFocusId(props.rowIndex)}
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

function ResultsCell(props: {
  columnIndex: number
  columnWidth: number
  remembered: boolean
  value: string
}) {
  const { columnIndex, columnWidth, remembered, value } = props
  const theme = useTheme()
  const focused = useIsFocused()
  const navigationActive = useIsFocusNavigationActive()
  const showPopout = focused && !navigationActive && shouldPopOut(value, columnWidth)

  return (
    <Focusable
      focusable
      focusableId={resultsTableCellFocusId(columnIndex)}
      height={1}
      navigable={false}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      position="relative"
      width="100%"
    >
      <box
        backgroundColor={focused ? theme.focusBg : (remembered ? theme.inputBg : undefined)}
        position="relative"
        width="100%"
      >
        <Text wrapMode="none" truncate>{" " + value}</Text>
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

function navigateResultsGrid(
  key: KeyEvent,
  current: CellCoordinates,
  rowCount: number,
  columnCount: number,
): CellCoordinates | undefined {
  if (rowCount === 0 || columnCount === 0) {
    return undefined
  }

  const edgeJump = key.ctrl || key.meta

  switch (key.name) {
    case "left":
      return {
        rowIndex: current.rowIndex,
        columnIndex: edgeJump ? 0 : current.columnIndex - 1,
      }
    case "right":
      return {
        rowIndex: current.rowIndex,
        columnIndex: edgeJump ? columnCount - 1 : current.columnIndex + 1,
      }
    case "up":
      return {
        rowIndex: edgeJump ? 0 : current.rowIndex - 1,
        columnIndex: current.columnIndex,
      }
    case "down":
      return {
        rowIndex: edgeJump ? rowCount - 1 : current.rowIndex + 1,
        columnIndex: current.columnIndex,
      }
    case "h":
      if (!hasPlainLetterModifiers(key)) return undefined
      return { rowIndex: current.rowIndex, columnIndex: current.columnIndex - 1 }
    case "j":
      if (!hasPlainLetterModifiers(key)) return undefined
      return { rowIndex: current.rowIndex + 1, columnIndex: current.columnIndex }
    case "k":
      if (!hasPlainLetterModifiers(key)) return undefined
      return { rowIndex: current.rowIndex - 1, columnIndex: current.columnIndex }
    case "l":
      if (!hasPlainLetterModifiers(key)) return undefined
      return { rowIndex: current.rowIndex, columnIndex: current.columnIndex + 1 }
    case "tab":
      if (key.ctrl || key.meta || key.option) return undefined
      return {
        rowIndex: current.rowIndex,
        columnIndex: current.columnIndex + (key.shift ? -1 : 1),
      }
    case "enter":
    case "return":
      if (key.ctrl || key.meta || key.option) return undefined
      return {
        rowIndex: current.rowIndex + (key.shift ? -1 : 1),
        columnIndex: current.columnIndex,
      }
    case "home":
      return edgeJump
        ? { rowIndex: 0, columnIndex: 0 }
        : { rowIndex: current.rowIndex, columnIndex: 0 }
    case "end":
      return edgeJump
        ? { rowIndex: rowCount - 1, columnIndex: columnCount - 1 }
        : { rowIndex: current.rowIndex, columnIndex: columnCount - 1 }
    default:
      return undefined
  }
}

function hasPlainLetterModifiers(key: KeyEvent): boolean {
  return !key.ctrl && !key.meta && !key.option
}

function clampCellCoordinates(
  coords: CellCoordinates,
  rowCount: number,
  columnCount: number,
): CellCoordinates {
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

function resultsTableCellPath(rowIndex: number, columnIndex: number): readonly [string, string, string, string] {
  return [
    RESULTS_TABLE_FOCUS_ID,
    RESULTS_TABLE_GRID_AREA_ID,
    resultsTableRowFocusId(rowIndex),
    resultsTableCellFocusId(columnIndex),
  ]
}

function resolveFocusedCellCoordinates(
  path: readonly string[] | undefined,
  rowIndexById: ReadonlyMap<string, number>,
  columnIndexById: ReadonlyMap<string, number>,
): CellCoordinates | undefined {
  if (!path || path.length < 4 || path[0] !== RESULTS_TABLE_FOCUS_ID || path[1] !== RESULTS_TABLE_GRID_AREA_ID) {
    return undefined
  }

  const rowId = path[2]
  const columnId = path[3]
  if (!rowId || !columnId) {
    return undefined
  }

  const rowIndex = rowIndexById.get(rowId)
  const columnIndex = columnIndexById.get(columnId)
  if (rowIndex === undefined || columnIndex === undefined) {
    return undefined
  }

  return { rowIndex, columnIndex }
}

function sameCellCoordinates(
  coords: CellCoordinates | undefined,
  rowIndex: number,
  columnIndex: number,
): boolean {
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
