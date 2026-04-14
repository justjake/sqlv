import type { KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useMemo, useRef, type ReactNode } from "react"
import {
  FocusHalo,
  FocusNavigable,
  FocusNavigableArea,
  useFocusNavigationState,
  useFocusTree,
  useIsFocusNavigableFocused,
  useIsFocusNavigableHighlighted,
  useIsFocusNavigationActive,
  useIsFocusWithin,
} from "../focus"
import { useKeybind } from "../ui/keybind"
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
  const { rows, width } = props
  const theme = useTheme()
  const tree = useFocusTree()
  const { inChordRef } = useKeybind()
  const navigationActive = useIsFocusNavigationActive()
  const focusState = useFocusNavigationState()
  const focusedWithin = useIsFocusWithin([RESULTS_TABLE_FOCUS_ID])

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

  const cellCount = rows.length * columnKeys.length
  const activeCell = useMemo(
    () => resolveFocusedCellCoordinates(focusState.focusedPath),
    [focusState.focusedPath],
  )
  const focusedWithinRef = useRef(focusedWithin)
  const navigationActiveRef = useRef(navigationActive)
  const activeCellRef = useRef(activeCell)
  const rowCountRef = useRef(rows.length)
  const columnCountRef = useRef(columnKeys.length)

  focusedWithinRef.current = focusedWithin
  navigationActiveRef.current = navigationActive
  activeCellRef.current = activeCell
  rowCountRef.current = rows.length
  columnCountRef.current = columnKeys.length

  function focusCell(coords: CellCoordinates): boolean {
    if (cellCount === 0) {
      return false
    }

    const next = clampCellCoordinates(coords, rows.length, columnKeys.length)
    return tree.focusPath(resultsTableCellPath(next.rowIndex, next.columnIndex))
  }

  function focusCellDeferred(coords: CellCoordinates) {
    if (cellCount === 0) {
      return
    }

    queueMicrotask(() => {
      void focusCell(coords)
    })
  }

  const focusCellRef = useRef(focusCell)
  focusCellRef.current = focusCell

  useKeyboard((key: KeyEvent) => {
    if (
      navigationActiveRef.current ||
      inChordRef.current ||
      !focusedWithinRef.current ||
      rowCountRef.current === 0 ||
      columnCountRef.current === 0
    ) {
      return
    }

    const current = activeCellRef.current ?? { rowIndex: 0, columnIndex: 0 }
    const next = navigateResultsGrid(key, current, rowCountRef.current, columnCountRef.current)
    if (!next) {
      return
    }

    key.preventDefault()
    key.stopPropagation()
    void focusCellRef.current(next)
  })

  const columns = useMemo(() => {
    const cols: Record<string, TableColumn<object>> = {}
    for (const [columnIndex, key] of columnKeys.entries()) {
      const maxContentWidth = Math.max(key.length, ...displayRows.map((row) => row[key]!.length))
      cols[key] = {
        width: { grow: growWidthForColumn(maxContentWidth) },
        Header: () => <text wrapMode="none" truncate>{" " + key}</text>,
        Cell: ({ rowIndex, columnWidth }) => (
          <ResultsCell
            columnIndex={columnIndex}
            columnWidth={columnWidth}
            value={displayRows[rowIndex]![key]}
          />
        ),
      }
    }
    return cols
  }, [columnKeys, displayRows])

  if (rows.length === 0) return <text>No results.</text>

  return (
    <FocusNavigable
      flexDirection="column"
      focus={() => focusCellDeferred({ rowIndex: 0, columnIndex: 0 })}
      focusNavigableId={RESULTS_TABLE_FOCUS_ID}
      position="relative"
    >
      <box flexDirection="column" position="relative">
        <FocusNavigableArea flexDirection="column" focusNavigableId={RESULTS_TABLE_GRID_AREA_ID}>
          <Table
            rows={rows}
            columns={columns}
            width={width}
            headerBg={theme.inputBg}
            borderColor={theme.borderColor}
            wrapRow={({ rowIndex, children }) => (
              <ResultsRow
                rowIndex={rowIndex}
                onFocus={() => focusCellDeferred({ rowIndex, columnIndex: 0 })}
              >
                {children}
              </ResultsRow>
            )}
          />
        </FocusNavigableArea>
        <FocusHalo />
      </box>
    </FocusNavigable>
  )
}

function ResultsRow(props: {
  rowIndex: number
  onFocus: () => void
  children: ReactNode
}) {
  return (
    <FocusNavigable
      focus={props.onFocus}
      focusNavigableId={resultsTableRowFocusId(props.rowIndex)}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      position="relative"
      width="100%"
    >
      <box position="relative" width="100%">
        {props.children}
        <FocusHalo />
      </box>
    </FocusNavigable>
  )
}

function ResultsCell(props: {
  columnIndex: number
  columnWidth: number
  value: string
}) {
  const { columnIndex, columnWidth, value } = props
  const theme = useTheme()
  const focused = useIsFocusNavigableFocused()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const showPopout = focused && !navigationActive && shouldPopOut(value, columnWidth)

  return (
    <FocusNavigable
      focusNavigableId={resultsTableCellFocusId(columnIndex)}
      height={1}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      position="relative"
      width="100%"
    >
      <box
        backgroundColor={navigationActive && highlighted ? theme.focusNavBg : (focused ? theme.focusBg : undefined)}
        position="relative"
        width="100%"
      >
        <text wrapMode="none" truncate>{" " + value}</text>
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
            <text wrapMode={resolvePopOutWrapMode(value)}>{" " + value}</text>
          </box>
        )}
        <FocusHalo />
      </box>
    </FocusNavigable>
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
  return !key.ctrl && !key.meta && !key.option && !key.shift
}

function resolveFocusedCellCoordinates(path: readonly string[] | undefined): CellCoordinates | undefined {
  return parseFocusedCellCoordinates(path) ?? parseFocusedRowCoordinates(path) ?? parseFocusedTableCoordinates(path)
}

function parseFocusedCellCoordinates(path: readonly string[] | undefined): CellCoordinates | undefined {
  if (!path || path.length !== 4) {
    return undefined
  }
  if (path[0] !== RESULTS_TABLE_FOCUS_ID || path[1] !== RESULTS_TABLE_GRID_AREA_ID) {
    return undefined
  }

  const rowIndex = parseIndexedFocusId(path[2], "row-")
  const columnIndex = parseIndexedFocusId(path[3], "cell-")
  if (rowIndex === undefined || columnIndex === undefined) {
    return undefined
  }

  return { rowIndex, columnIndex }
}

function parseFocusedRowCoordinates(path: readonly string[] | undefined): CellCoordinates | undefined {
  const rowIndex = parseFocusedRowIndex(path)
  if (rowIndex === undefined) {
    return undefined
  }
  return { rowIndex, columnIndex: 0 }
}

function parseFocusedTableCoordinates(path: readonly string[] | undefined): CellCoordinates | undefined {
  if (!path || path[0] !== RESULTS_TABLE_FOCUS_ID) {
    return undefined
  }
  return { rowIndex: 0, columnIndex: 0 }
}

function parseFocusedRowIndex(path: readonly string[] | undefined): number | undefined {
  if (!path || path.length < 3) {
    return undefined
  }
  if (path[0] !== RESULTS_TABLE_FOCUS_ID || path[1] !== RESULTS_TABLE_GRID_AREA_ID) {
    return undefined
  }
  return parseIndexedFocusId(path[2], "row-")
}

function parseIndexedFocusId(value: string | undefined, prefix: string): number | undefined {
  if (!value?.startsWith(prefix)) {
    return undefined
  }
  const index = Number.parseInt(value.slice(prefix.length), 10)
  return Number.isFinite(index) ? index : undefined
}

function resultsTableCellPath(rowIndex: number, columnIndex: number): readonly string[] {
  return [
    RESULTS_TABLE_FOCUS_ID,
    RESULTS_TABLE_GRID_AREA_ID,
    resultsTableRowFocusId(rowIndex),
    resultsTableCellFocusId(columnIndex),
  ]
}

function clampCellCoordinates(
  coords: CellCoordinates,
  rowCount: number,
  columnCount: number,
): CellCoordinates {
  return {
    rowIndex: clamp(coords.rowIndex, 0, rowCount - 1),
    columnIndex: clamp(coords.columnIndex, 0, columnCount - 1),
  }
}

function shouldPopOut(value: string, columnWidth: number): boolean {
  if (columnWidth <= 0) {
    return value.length > 0
  }

  return value.includes("\n") || value.length + 1 > columnWidth
}

function resolvePopOutWrapMode(value: string): "word" | "char" {
  return /\s/.test(value) ? "word" : "char"
}

function formatValue(value: unknown): string {
  if (value === null) return "NULL"
  if (value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value)
  return JSON.stringify(value)
}

function growWidthForColumn(maxContentWidth: number): number {
  return clamp(maxContentWidth + 2, 4, 32)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
