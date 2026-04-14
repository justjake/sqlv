import { useMemo } from "react"
import { useTheme } from "../ui/theme"
import { Table, type TableColumn } from "./table"

export function ResultsTable(props: { rows: object[]; width?: number }) {
  const { rows, width } = props
  const theme = useTheme()

  const columns = useMemo(() => {
    const records = rows as Record<string, unknown>[]
    const keys = new Set<string>()
    for (const row of records) {
      for (const key of Object.keys(row)) keys.add(key)
    }

    const displayRows = records.map((row) => {
      const values: Record<string, string> = {}
      for (const key of keys) {
        values[key] = formatValue(row[key])
      }
      return values
    })

    const cols: Record<string, TableColumn<object>> = {}
    for (const key of keys) {
      const maxContentWidth = Math.max(key.length, ...displayRows.map((row) => row[key]!.length))
      cols[key] = {
        width: { grow: growWidthForColumn(maxContentWidth) },
        Header: () => <text wrapMode="none" truncate>{" " + key}</text>,
        Cell: ({ rowIndex }) => <text wrapMode="none" truncate>{" " + displayRows[rowIndex]![key]}</text>,
      }
    }
    return cols
  }, [rows])

  if (rows.length === 0) return <text>No results.</text>

  return (
    <Table
      rows={rows}
      columns={columns}
      width={width}
      headerBg={theme.inputBg}
      borderColor={theme.borderColor}
    />
  )
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
