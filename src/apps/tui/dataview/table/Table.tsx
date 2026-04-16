import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { Fragment, type ReactNode, useMemo, useRef, useState } from "react"
import { Text } from "../../ui/Text"

// ── Border Characters ──────────────────────────────────────────────────────

export type BorderChars = {
  topLeft: string
  top: string
  topRight: string
  bottomLeft: string
  bottom: string
  bottomRight: string
  left: string
  right: string
  topTee: string
  bottomTee: string
  leftTee: string
  rightTee: string
  cross: string
}

export const singleBorder: BorderChars = {
  topLeft: "┌",
  top: "─",
  topRight: "┐",
  bottomLeft: "└",
  bottom: "─",
  bottomRight: "┘",
  left: "│",
  right: "│",
  topTee: "┬",
  bottomTee: "┴",
  leftTee: "├",
  rightTee: "┤",
  cross: "┼",
}

export const roundedBorder: BorderChars = {
  ...singleBorder,
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
}

export const heavyBorder: BorderChars = {
  topLeft: "┏",
  top: "━",
  topRight: "┓",
  bottomLeft: "┗",
  bottom: "━",
  bottomRight: "┛",
  left: "┃",
  right: "┃",
  topTee: "┳",
  bottomTee: "┻",
  leftTee: "┣",
  rightTee: "┫",
  cross: "╋",
}

export const doubleBorder: BorderChars = {
  topLeft: "╔",
  top: "═",
  topRight: "╗",
  bottomLeft: "╚",
  bottom: "═",
  bottomRight: "╝",
  left: "║",
  right: "║",
  topTee: "╦",
  bottomTee: "╩",
  leftTee: "╠",
  rightTee: "╣",
  cross: "╬",
}

// ── Column Width ───────────────────────────────────────────────────────────

export type WidthSpec = {
  /** Fixed width in character columns. */
  absolute?: number
  /** Proportional weight for distributing remaining space after
   *  absolute and percent columns are allocated. */
  grow?: number
  /** Width as a percentage of total content width (0–100). */
  percent?: number
}

// ── Column Definition ──────────────────────────────────────────────────────

export type TableColumn<T> = {
  width: WidthSpec
  /** Custom header renderer. Defaults to column name as plain text. */
  Header?: (props: { column: string; columnIndex: number; columnWidth: number }) => ReactNode
  /** Cell content renderer for each data row. */
  Cell: (props: { row: T; rowIndex: number; column: string; columnIndex: number; columnWidth: number }) => ReactNode
}

// ── Border Configuration ───────────────────────────────────────────────────

export type BorderConfig = {
  top?: boolean
  bottom?: boolean
  left?: boolean
  right?: boolean
  /** Horizontal separator between header and body. */
  header?: boolean
  /** Vertical separators between columns. */
  columns?: boolean
  /** Horizontal separators between data rows. */
  rows?: boolean
}

// ── Table Props ────────────────────────────────────────────────────────────

export type TableProps<T> = {
  rows: T[]
  columns: Record<string, TableColumn<T>>
  /**
   * Border preset or fine-grained config.
   * - `true` — full grid (all borders and separators).
   * - `"outer"` — perimeter only, no interior lines.
   * - `"header"` — perimeter + header separator + column dividers.
   * - `false` — no borders at all.
   * - `BorderConfig` — full control over each edge and separator.
   *
   * Default: column dividers only (no outer border or header separator).
   */
  border?: BorderConfig | boolean | "outer" | "header"
  /** Border character set. Defaults to `singleBorder`. */
  borderStyle?: BorderChars
  /** Foreground color for border characters (hex string). */
  borderColor?: string
  /** Total width in characters. Defaults to terminal width. */
  width?: number
  /** Show a header row. Defaults to `true`. */
  header?: boolean
  /** Background color for the header row (hex string). */
  headerBg?: string
  /** Stable key extractor for each row. Falls back to row index. */
  getRowKey?: (row: T, index: number) => string
  /** Optional wrapper for each rendered data row. */
  wrapRow?: (props: { row: T; rowIndex: number; children: ReactNode }) => ReactNode
}

// ── Internals ──────────────────────────────────────────────────────────────

const DEFAULT_BORDER: BorderConfig = { columns: true }

function normalizeBorder(input: TableProps<any>["border"]): BorderConfig {
  if (input === undefined) return DEFAULT_BORDER
  if (input === false) return {}
  if (input === true)
    return { top: true, bottom: true, left: true, right: true, header: true, columns: true, rows: true }
  if (input === "outer") return { top: true, bottom: true, left: true, right: true }
  if (input === "header") return { top: true, bottom: true, left: true, right: true, header: true, columns: true }
  return input
}

function borderOverhead(border: BorderConfig, numColumns: number): number {
  let n = 0
  if (border.left) n++
  if (border.right) n++
  if (border.columns && numColumns > 1) n += numColumns - 1
  return n
}

function computeWidths(specs: WidthSpec[], totalContentWidth: number): number[] {
  const n = specs.length
  if (n === 0 || totalContentWidth <= 0) {
    return new Array<number>(n).fill(0)
  }

  const widths = new Array<number>(n).fill(0)
  const sized = new Array<boolean>(n).fill(false)
  let remaining = totalContentWidth

  // Pass 1: fixed character widths
  for (let i = 0; i < n; i++) {
    const { absolute } = specs[i]!
    if (absolute != null) {
      widths[i] = absolute
      remaining -= absolute
      sized[i] = true
    }
  }

  // Pass 2: percentage of total content width
  for (let i = 0; i < n; i++) {
    if (sized[i]) continue
    const { percent } = specs[i]!
    if (percent != null) {
      const w = Math.floor((totalContentWidth * percent) / 100)
      widths[i] = w
      remaining -= w
      sized[i] = true
    }
  }

  // Pass 3: distribute remaining space by grow weight (default 1)
  let totalGrow = 0
  for (let i = 0; i < n; i++) {
    if (sized[i]) continue
    totalGrow += specs[i]!.grow ?? 1
  }

  if (totalGrow > 0 && remaining > 0) {
    const growIndexes: number[] = []
    for (let i = 0; i < n; i++) {
      if (!sized[i]) growIndexes.push(i)
    }

    const reserved = Math.min(remaining, growIndexes.length)
    for (let i = 0; i < reserved; i++) {
      const index = growIndexes[i]!
      widths[index] = 1
      remaining -= 1
    }

    let allocated = 0
    let lastIdx = -1
    for (const index of growIndexes) {
      const grow = specs[index]!.grow ?? 1
      const extra = Math.floor((remaining * grow) / totalGrow)
      widths[index]! += extra
      allocated += extra
      lastIdx = index
    }
    // Assign rounding remainder to the last grow column
    if (lastIdx >= 0) widths[lastIdx]! += remaining - allocated
  }

  return widths.map((width) => Math.max(0, width))
}

function hline(
  widths: number[],
  border: BorderConfig,
  chars: BorderChars,
  position: "top" | "middle" | "bottom",
): string {
  const [cap0, cap1, tee, fill] =
    position === "top"
      ? ([chars.topLeft, chars.topRight, chars.topTee, chars.top] as const)
      : position === "bottom"
        ? ([chars.bottomLeft, chars.bottomRight, chars.bottomTee, chars.bottom] as const)
        : ([chars.leftTee, chars.rightTee, chars.cross, chars.top] as const)

  let s = ""
  if (border.left) s += cap0
  for (let i = 0; i < widths.length; i++) {
    if (i > 0 && border.columns) s += tee
    s += fill.repeat(widths[i]!)
  }
  if (border.right) s += cap1
  return s
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TableRow(props: {
  widths: number[]
  border: BorderConfig
  chars: BorderChars
  borderColor: string | undefined
  backgroundColor?: string
  cells: ReactNode[]
}) {
  const { widths, border, chars, borderColor, backgroundColor, cells } = props
  const elements: ReactNode[] = []

  if (border.left)
    elements.push(
      <Text key="bl" fg={borderColor}>
        {chars.left}
      </Text>,
    )

  for (let i = 0; i < cells.length; i++) {
    if (i > 0 && border.columns)
      elements.push(
        <Text key={`sep${i}`} fg={borderColor}>
          {chars.left}
        </Text>,
      )
    elements.push(
      <box key={`c${i}`} width={widths[i]} flexGrow={0} flexShrink={0}>
        {cells[i]}
      </box>,
    )
  }

  if (border.right)
    elements.push(
      <Text key="br" fg={borderColor}>
        {chars.right}
      </Text>,
    )

  return (
    <box flexDirection="row" backgroundColor={backgroundColor}>
      {elements}
    </box>
  )
}

// ── Table ──────────────────────────────────────────────────────────────────

export function Table<T>(rawProps: TableProps<T>) {
  const { width: termWidth } = useTerminalDimensions()
  const containerRef = useRef<BoxRenderable | null>(null)
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(rawProps.width)
  const {
    rows,
    columns,
    header: showHeader = true,
    borderStyle: chars = singleBorder,
    borderColor,
    headerBg,
    getRowKey,
    wrapRow,
  } = rawProps

  const border = useMemo(() => normalizeBorder(rawProps.border), [rawProps.border])
  const totalWidth = rawProps.width ?? measuredWidth ?? termWidth

  function handleSizeChange() {
    const nextWidth = containerRef.current?.width
    if (!nextWidth) return
    setMeasuredWidth((current) => (current === nextWidth ? current : nextWidth))
  }

  const { names, widths } = useMemo(() => {
    const entries = Object.entries(columns)
    const names = entries.map(([k]) => k)
    const specs = entries.map(([, v]) => v.width)
    const contentWidth = Math.max(0, totalWidth - borderOverhead(border, names.length))
    return { names, widths: computeWidths(specs, contentWidth) }
  }, [columns, totalWidth, border])

  const lines = useMemo(
    () => ({
      top: border.top ? hline(widths, border, chars, "top") : null,
      headerSep: border.header ? hline(widths, border, chars, "middle") : null,
      rowSep: border.rows ? hline(widths, border, chars, "middle") : null,
      bottom: border.bottom ? hline(widths, border, chars, "bottom") : null,
    }),
    [widths, border, chars],
  )

  const headerCells = showHeader
    ? names.map((name, i) => {
        const col = columns[name]!
        return col.Header ? (
          col.Header({ column: name, columnIndex: i, columnWidth: widths[i] ?? 0 })
        ) : (
          <Text key={name} wrapMode="none" truncate>
            {" " + name}
          </Text>
        )
      })
    : null

  return (
    <box ref={containerRef} flexDirection="column" width={rawProps.width ?? "100%"} onSizeChange={handleSizeChange}>
      {lines.top && <Text fg={borderColor}>{lines.top}</Text>}

      {headerCells && (
        <TableRow
          widths={widths}
          border={border}
          chars={chars}
          borderColor={borderColor}
          backgroundColor={headerBg}
          cells={headerCells}
        />
      )}
      {showHeader && lines.headerSep && <Text fg={borderColor}>{lines.headerSep}</Text>}

      {rows.map((row, rowIndex) => {
        const key = getRowKey?.(row, rowIndex) ?? String(rowIndex)
        const rowContent = (
          <TableRow
            widths={widths}
            border={border}
            chars={chars}
            borderColor={borderColor}
            cells={names.map((name, colIndex) =>
              columns[name]!.Cell({
                row,
                rowIndex,
                column: name,
                columnIndex: colIndex,
                columnWidth: widths[colIndex] ?? 0,
              }),
            )}
          />
        )
        return (
          <Fragment key={key}>
            {rowIndex > 0 && lines.rowSep && <Text fg={borderColor}>{lines.rowSep}</Text>}
            {wrapRow ? wrapRow({ row, rowIndex, children: rowContent }) : rowContent}
          </Fragment>
        )
      })}

      {lines.bottom && <Text fg={borderColor}>{lines.bottom}</Text>}
    </box>
  )
}
