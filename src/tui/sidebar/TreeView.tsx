import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo } from "react"
import { sameFocusPath } from "../../lib/focus"
import {
  Focusable,
  useFocusedDescendantPath,
  useIsFocusNavigationActive,
  useIsFocusWithin,
  useRememberedDescendantPath,
  useFocusTree,
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
  return (
    <Focusable
      childrenNavigable={false}
      delegatesFocus
      focusSelf
      focusable
      flexDirection="column"
      focusableId={SIDEBAR_TREE_AREA_ID}
    >
      <TreeViewBody {...props} />
    </Focusable>
  )
}

function TreeViewBody(props: TreeProps) {
  const { nodes, onFocus, onEnter } = props
  const { inChordRef } = useKeybind()
  const tree = useFocusTree()
  const rows = useMemo(() => flattenTree(nodes), [nodes])
  const focusedWithin = useIsFocusWithin([SIDEBAR_TREE_AREA_ID])
  const navigationActive = useIsFocusNavigationActive()
  const focusedRowPath = useFocusedDescendantPath()
  const rememberedRowPath = useRememberedDescendantPath()

  const focusedIndex = rows.findIndex((row) => sameFocusPath(focusedRowPath, treeRowPath(row.rowKey)))
  const currentIndex = focusedIndex >= 0 ? focusedIndex : 0
  const currentRow = rows[currentIndex]

  useEffect(() => {
    const node = currentRow?.node
    if (node) {
      onFocus?.(currentIndex, node)
    }
  }, [currentIndex, currentRow, onFocus])

  function focusRow(nextIndex: number) {
    const row = rows[nextIndex]
    if (!row) {
      return
    }
    tree.focusPath(treeRowPath(row.rowKey))
  }

  useKeyboard((key) => {
    if (navigationActive || inChordRef.current || !focusedWithin || rows.length === 0) {
      return
    }

    switch (key.name) {
      case "up":
        focusRow(Math.max(0, currentIndex - 1))
        return
      case "down":
        focusRow(Math.min(rows.length - 1, currentIndex + 1))
        return
      case "enter":
      case "return": {
        const node = currentRow?.node
        if (!node) {
          return
        }
        onEnter?.(currentIndex, node)
      }
    }
  })

  return (
    <box flexDirection="column">
      {rows.length === 0 && (
        <Focusable focusable focusableId="empty" navigable={false}>
          <box paddingLeft={1}>
            <text>No objects yet.</text>
          </box>
        </Focusable>
      )}
      {rows.map((row) => {
        const path = treeRowPath(row.rowKey)
        const focused = sameFocusPath(path, focusedRowPath)
        const remembered = !focusedWithin && sameFocusPath(path, rememberedRowPath)
        return (
          <Focusable
            key={row.rowKey}
            focusable
            focusableId={rowFocusId(row.rowKey)}
            navigable={false}
          >
            <TreeNodeView focused={focused} remembered={remembered} {...row} />
          </Focusable>
        )
      })}
    </box>
  )
}

function TreeNodeView(props: FlatTreeNode & { focused: boolean; remembered: boolean }) {
  const { node, focused, isLast, level, parentIsLastPath, remembered } = props
  const theme = useTheme()
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
    <box backgroundColor={focused ? theme.focusBg : (remembered ? theme.inputBg : undefined)} flexDirection="row">
      <text fg={theme.mutedFg}>{` ${guides}${marker} `}</text>
      <text>{node.name}</text>
    </box>
  )
}

function treeRowPath(rowKey: string): readonly [string, string] {
  return [SIDEBAR_TREE_AREA_ID, rowFocusId(rowKey)]
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
