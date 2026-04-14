import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import {
  FocusNavigable,
  FocusNavigableArea,
  useFocusTree,
  useIsFocusNavigableHighlighted,
  useIsFocusNavigationActive,
  useIsFocusWithin,
} from "../focus"
import { useKeybind } from "../ui/keybind"
import { useTheme } from "../ui/theme"

export type TreeNode = {
  key: string
  name: string
  kind?: string
  connectionId?: string
  expandable?: boolean
  children?: TreeNode[]
}

type FlatTreeNode = {
  node: TreeNode
  rowKey: string
  level: number
  isLast: boolean
  parentIsLastPath: boolean[]
}

type TreeProps = {
  nodes: TreeNode[]
  onFocus?: (idx: number, node: TreeNode) => void
  onEnter?: (idx: number, node: TreeNode) => void
}

export const SIDEBAR_TREE_AREA_ID = "sidebar-tree"

const GUIDE_PIPE = "│"
const GUIDE_BRANCH = "├"
const GUIDE_CORNER = "└"
const EXPAND_OPEN = "▼"
const EXPAND_CLOSED = "▶"

export function TreeView(props: TreeProps) {
  const { nodes, onFocus, onEnter } = props
  const { inChordRef } = useKeybind()
  const tree = useFocusTree()
  const rows = useMemo(() => flattenTree(nodes), [nodes])
  const focusedWithin = useIsFocusWithin([SIDEBAR_TREE_AREA_ID])
  const navigationActive = useIsFocusNavigationActive()

  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex((current) => clampTreeIndex(current, rows.length))
  }, [rows.length])

  useEffect(() => {
    const node = rows[index]?.node
    if (node) {
      onFocus?.(index, node)
    }
  }, [index, onFocus, rows])

  function focusRow(nextIndex: number) {
    const row = rows[nextIndex]
    if (!row) {
      return
    }
    setIndex(nextIndex)
    tree.focusPath([SIDEBAR_TREE_AREA_ID, rowFocusId(row.rowKey)])
  }

  useKeyboard((key) => {
    if (navigationActive || inChordRef.current || !focusedWithin || rows.length === 0) {
      return
    }

    switch (key.name) {
      case "up":
        focusRow(Math.max(0, index - 1))
        return
      case "down":
        focusRow(Math.min(rows.length - 1, index + 1))
        return
      case "enter":
      case "return": {
        const node = rows[index]?.node
        if (!node) {
          return
        }
        onEnter?.(index, node)
      }
    }
  })

  return (
    <FocusNavigableArea flexDirection="column" focusNavigableId={SIDEBAR_TREE_AREA_ID}>
      <box flexDirection="column">
        {rows.map((row, rowIndex) => (
          <FocusNavigable key={row.rowKey} focus={() => setIndex(rowIndex)} focusNavigableId={rowFocusId(row.rowKey)}>
            <TreeNodeView active={rowIndex === index} {...row} />
          </FocusNavigable>
        ))}
      </box>
    </FocusNavigableArea>
  )
}

function TreeNodeView(props: FlatTreeNode & { active: boolean }) {
  const { node, level, isLast, parentIsLastPath, active } = props
  const theme = useTheme()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const isExpanded = node.expandable && node.children !== undefined
  const isCollapsed = node.expandable && node.children === undefined

  let guides = ""
  for (let i = 0; i < level; i += 1) {
    guides += parentIsLastPath[i] ? "  " : `${GUIDE_PIPE} `
  }

  let marker: string
  if (isExpanded) {
    marker = EXPAND_OPEN
  } else if (isCollapsed) {
    marker = EXPAND_CLOSED
  } else if (isLast) {
    marker = GUIDE_CORNER
  } else {
    marker = GUIDE_BRANCH
  }

  return (
    <box backgroundColor={navigationActive && highlighted ? theme.focusNavBg : (active ? theme.focusBg : undefined)} flexDirection="row">
      <text fg={theme.mutedFg}>{` ${guides}${marker} `}</text>
      <text>{node.name}</text>
    </box>
  )
}

function rowFocusId(rowKey: string): string {
  return `row-${rowKey}`
}

export function flattenTree(
  nodes: TreeNode[],
  parentPath = "",
  level = 0,
  parentIsLastPath: boolean[] = [],
): FlatTreeNode[] {
  const flat: FlatTreeNode[] = []
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    const isLast = i === nodes.length - 1
    const rowKey = parentPath ? `${parentPath}.${node.key}` : node.key
    flat.push({
      node,
      rowKey,
      level,
      isLast,
      parentIsLastPath,
    })
    if (node.children?.length) {
      flat.push(...flattenTree(node.children, rowKey, level + 1, [...parentIsLastPath, isLast]))
    }
  }

  return flat
}

function clamp(index: number, length: number): number {
  if (length === 0) {
    return 0
  }
  return Math.min(Math.max(index, 0), length - 1)
}

export const clampTreeIndex = clamp
