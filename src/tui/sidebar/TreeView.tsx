import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"

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
  focused?: boolean
  nodes: TreeNode[]
  onFocus?: (idx: number, node: TreeNode) => void
  onEnter?: (idx: number, node: TreeNode) => void
}

// Box-drawing characters
const GUIDE_PIPE = "│"
const GUIDE_BRANCH = "├"
const GUIDE_CORNER = "└"
const EXPAND_OPEN = "▼"
const EXPAND_CLOSED = "▶"

export function TreeView(props: TreeProps) {
  const { nodes, onFocus, onEnter } = props
  const rows = useMemo(() => flattenTree(nodes), [nodes])

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

  useKeyboard((key) => {
    if (!props.focused || rows.length === 0) {
      return
    }

    switch (key.name) {
      case "up":
        return setIndex((current) => Math.max(0, current - 1))
      case "down":
        return setIndex((current) => Math.min(rows.length - 1, current + 1))
      case "enter": {
        const node = rows[index]?.node
        if (!node) {
          return
        }
        onEnter?.(index, node)
      }
    }
  })

  return (
    <box flexDirection="column">
      {rows.map((row, rowIndex) => (
        <TreeNodeView key={row.rowKey} active={rowIndex === index} {...row} />
      ))}
    </box>
  )
}

function TreeNodeView(props: FlatTreeNode & { active: boolean }) {
  const { node, level, isLast, parentIsLastPath, active } = props
  const isExpanded = node.expandable && node.children !== undefined
  const isCollapsed = node.expandable && node.children === undefined

  // Build indent guides for ancestor levels
  let guides = ""
  for (let i = 0; i < level; i++) {
    guides += parentIsLastPath[i] ? "  " : `${GUIDE_PIPE} `
  }

  // Current level marker
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
    <box backgroundColor={active ? "blue" : undefined} flexDirection="row">
      <text fg="#666666">{` ${guides}${marker} `}</text>
      <text>{node.name}</text>
    </box>
  )
}

export function flattenTree(
  nodes: TreeNode[],
  parentPath = "",
  level = 0,
  parentIsLastPath: boolean[] = [],
): FlatTreeNode[] {
  const flat: FlatTreeNode[] = []
  for (let i = 0; i < nodes.length; i++) {
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
