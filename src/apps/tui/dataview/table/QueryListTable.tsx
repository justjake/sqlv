import type { ReactNode } from "react"

import { useIsFocusNavigationActive, useIsHighlighted } from "../../focus/context"
import { Focusable } from "../../focus/Focusable"
import { useTheme } from "../../ui/theme"

import { Table, type TableColumn } from "./Table"

export type QueryListTableProps<Row> = {
  rows: Row[]
  columns: Record<string, TableColumn<Row>>
  width?: number
  getRowKey: (row: Row, index: number) => string
  getRowFocusableId?: (row: Row, index: number) => string | undefined
  isRowFocused?: (row: Row, index: number) => boolean
  isRowSelected?: (row: Row, index: number) => boolean
  isRowDimmed?: (row: Row, index: number) => boolean
}

export function QueryListTable<Row>(props: QueryListTableProps<Row>) {
  return (
    <Table
      rows={props.rows}
      border={false}
      columns={props.columns}
      header={false}
      width={props.width}
      getRowKey={props.getRowKey}
      wrapRow={({ row, rowIndex, children }) => {
        const focusableId = props.getRowFocusableId?.(row, rowIndex)
        if (!focusableId) {
          return <box width="100%">{children}</box>
        }

        return (
          <QueryListTableRow
            dimmed={props.isRowDimmed?.(row, rowIndex) ?? false}
            focused={props.isRowFocused?.(row, rowIndex) ?? false}
            focusableId={focusableId}
            selected={props.isRowSelected?.(row, rowIndex) ?? false}
          >
            {children}
          </QueryListTableRow>
        )
      }}
    />
  )
}

function QueryListTableRow(props: {
  dimmed: boolean
  focused: boolean
  focusableId: string
  selected: boolean
  children: ReactNode
}) {
  const theme = useTheme()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const backgroundColor =
    navigationActive && highlighted
      ? theme.focusNavBg
      : props.focused
        ? theme.focusBg
        : props.selected
          ? theme.inputBg
          : undefined

  return (
    <Focusable
      focusable
      focusableId={props.focusableId}
      hideNavigationHalo
      navigable={false}
      onMouseDown={(event) => {
        event.stopPropagation()
      }}
      position="relative"
      width="100%"
    >
      <box backgroundColor={backgroundColor} opacity={props.dimmed ? 0.75 : 1} position="relative" width="100%">
        {props.children}
      </box>
    </Focusable>
  )
}
