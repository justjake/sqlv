import type { BoxRenderable } from "@opentui/core"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { sameFocusPath } from "../../lib/focus"
import {
  Focusable,
  useFocusedDescendantPath,
  useIsFocusNavigationActive,
  useIsFocusWithin,
  useRememberedDescendantPath,
  useFocusTree,
} from "../focus"
import { useKeybind, useShortcut } from "../ui/keybind"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

export type TreeNode = {
  key: string
  name: string
  kind?: string
  connectionId?: string
  expandable?: boolean
  expanded?: boolean
  children?: TreeNode[]
}

type FlatTreeNode = {
  node: TreeNode
  rowKey: string
  level: number
  isLast: boolean
  parentIsLastPath: boolean[]
}

type VisibleTreeNode = FlatTreeNode & {
  parentRowKey?: string
  isExpandable: boolean
  isExpanded: boolean
}

type TreeProps = {
  nodes: TreeNode[]
  onFocus?: (idx: number, node: TreeNode) => void
  onExpand?: (idx: number, node: TreeNode) => void
  onSelect?: (idx: number, node: TreeNode) => void
}

export const SIDEBAR_TREE_AREA_ID = "sidebar-tree"

const GUIDE_PIPE = "│"
const LEAF_LAST = "└"
const LEAF_MIDDLE = "│"
const EXPAND_OPEN = ""
const EXPAND_CLOSED = ""
const FOLDER_OPEN = ""
const FOLDER_CLOSED = ""
const DEFAULT_FILE_ICON = "*"

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
  const { nodes, onExpand, onFocus, onSelect } = props
  const { inChordRef } = useKeybind()
  const tree = useFocusTree()
  const [expansionOverrides, setExpansionOverrides] = useState<Record<string, boolean>>({})
  const expansionState = useMemo(() => resolveExpansionState(nodes, expansionOverrides), [nodes, expansionOverrides])
  const rows = useMemo(() => flattenVisibleTree(nodes, expansionState.expandedRowKeys), [expansionState.expandedRowKeys, nodes])
  const focusedWithin = useIsFocusWithin([SIDEBAR_TREE_AREA_ID])
  const navigationActive = useIsFocusNavigationActive()
  const focusedRowPath = useFocusedDescendantPath()
  const rememberedRowPath = useRememberedDescendantPath()
  const theme = useTheme()

  const focusedIndex = rows.findIndex((row) => sameFocusPath(focusedRowPath, treeRowPath(row.rowKey)))
  const currentIndex = focusedIndex >= 0 ? focusedIndex : 0
  const currentRow = rows[currentIndex]

  useEffect(() => {
    const node = currentRow?.node
    if (node) {
      onFocus?.(currentIndex, node)
    }
  }, [currentIndex, currentRow, onFocus])

  useEffect(() => {
    setExpansionOverrides((current) => pruneExpansionOverrides(current, expansionState.allRowKeys))
  }, [expansionState.allRowKeySignature, expansionState.allRowKeys])

  function focusRow(nextIndex: number) {
    const row = rows[nextIndex]
    if (!row) {
      return
    }
    tree.focusPath(treeRowPath(row.rowKey))
  }

  function setRowExpanded(row: VisibleTreeNode, expanded: boolean) {
    if (!row.isExpandable || row.isExpanded === expanded) {
      return
    }

    setExpansionOverrides((current) => {
      if (current[row.rowKey] === expanded) {
        return current
      }
      return {
        ...current,
        [row.rowKey]: expanded,
      }
    })

    if (expanded) {
      const rowIndex = rows.findIndex((candidate) => candidate.rowKey === row.rowKey)
      onExpand?.(rowIndex >= 0 ? rowIndex : currentIndex, row.node)
    }
  }

  function toggleCurrentRow() {
    const row = currentRow
    if (!row) {
      return
    }

    toggleRow(row, currentIndex)
  }

  function toggleRow(row: VisibleTreeNode, rowIndex: number) {
    if (row.isExpandable) {
      setRowExpanded(row, !row.isExpanded)
      return
    }

    onSelect?.(rowIndex, row.node)
  }

  function toggleDisclosure(row: VisibleTreeNode) {
    const rowIndex = rows.findIndex((candidate) => candidate.rowKey === row.rowKey)
    tree.focusPath(treeRowPath(row.rowKey), "mouse")
    toggleRow(row, rowIndex >= 0 ? rowIndex : currentIndex)
  }

  const shortcutsEnabled = !navigationActive && !inChordRef.current && focusedWithin && rows.length > 0

  useShortcut({
    keys: ["up", "k"],
    enabled: shortcutsEnabled,
    onKey(key) {
      key.preventDefault()
      key.stopPropagation()
      focusRow(Math.max(0, currentIndex - 1))
    },
  })

  useShortcut({
    keys: ["down", "j"],
    enabled: shortcutsEnabled,
    onKey(key) {
      key.preventDefault()
      key.stopPropagation()
      focusRow(Math.min(rows.length - 1, currentIndex + 1))
    },
  })

  useShortcut({
    keys: ["left", "h"],
    enabled: shortcutsEnabled,
    onKey(key) {
      if (currentRow?.isExpandable && currentRow.isExpanded) {
        key.preventDefault()
        key.stopPropagation()
        setRowExpanded(currentRow, false)
        return
      }
      if (currentRow?.parentRowKey) {
        key.preventDefault()
        key.stopPropagation()
        tree.focusPath(treeRowPath(currentRow.parentRowKey))
      }
    },
  })

  useShortcut({
    keys: ["right", "l"],
    enabled: shortcutsEnabled,
    onKey(key) {
      if (currentRow?.isExpandable && !currentRow.isExpanded) {
        key.preventDefault()
        key.stopPropagation()
        setRowExpanded(currentRow, true)
      }
    },
  })

  useShortcut({
    keys: "enter",
    enabled: shortcutsEnabled,
    onKey(key) {
      key.preventDefault()
      key.stopPropagation()
      toggleCurrentRow()
    },
  })

  useShortcut({
    keys: "space",
    enabled: shortcutsEnabled,
    onKey(key) {
      key.preventDefault()
      key.stopPropagation()
      toggleCurrentRow()
    },
  })

  return (
    <box flexDirection="column">
      {rows.length === 0 && (
        <Focusable focusable focusableId="empty" navigable={false}>
          <box paddingLeft={1}>
            <Text fg={theme.primaryFg}>No objects yet.</Text>
          </box>
        </Focusable>
      )}
      {rows.map((row) => {
        const path = treeRowPath(row.rowKey)
        const focused = sameFocusPath(path, focusedRowPath)
        const remembered = !focusedWithin && sameFocusPath(path, rememberedRowPath)
        return (
          <TreeRow
            key={row.rowKey}
            row={row}
            onToggleDisclosure={row.isExpandable ? () => toggleDisclosure(row) : undefined}
          >
            <TreeNodeView {...row} focused={focused} remembered={remembered} />
          </TreeRow>
        )
      })}
    </box>
  )
}

function TreeRow(props: {
  row: VisibleTreeNode
  onToggleDisclosure?: () => void
  children: ReactNode
}) {
  const { children, onToggleDisclosure, row } = props
  const rowRef = useRef<BoxRenderable>(null)
  const disclosureOffset = treeDisclosureOffset(row)

  return (
    <box
      ref={rowRef}
      onMouseUp={(event) => {
        if (!onToggleDisclosure || !rowRef.current) {
          return
        }

        const localX = event.x - rowRef.current.x
        if (localX < disclosureOffset || localX > disclosureOffset + 1) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onToggleDisclosure()
      }}
      width="100%"
    >
      <Focusable
        focusable
        focusableId={rowFocusId(row.rowKey)}
        navigable={false}
      >
        <box width="100%">
          {children}
        </box>
      </Focusable>
    </box>
  )
}

function TreeNodeView(props: VisibleTreeNode & {
  focused: boolean
  remembered: boolean
}) {
  const { focused, node, remembered } = props
  const theme = useTheme()
  const prefix = treePrefix(props)
  const icon = treeIcon(props)
  const labelFg = focused ? theme.formFieldLabelActiveFg : theme.primaryFg
  const prefixFg = focused ? theme.formFieldLabelActiveFg : theme.mutedFg
  const iconFg = focused ? theme.formFieldLabelActiveFg : theme.focusBg

  return (
    <box
      backgroundColor={focused ? theme.focusBg : (remembered ? theme.inputBg : undefined)}
      flexDirection="row"
      width="100%"
    >
      <box flexGrow={0} flexShrink={0} width={textCells(prefix)}>
        <Text fg={prefixFg} wrapMode="none">{prefix}</Text>
      </box>
      <box flexGrow={0} flexShrink={0} width={textCells(icon)}>
        <Text fg={iconFg} wrapMode="none">{icon}</Text>
      </box>
      <box flexGrow={0} flexShrink={0} width={1}>
        <Text fg={prefixFg} wrapMode="none">{" "}</Text>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <Text fg={labelFg} truncate wrapMode="none">{node.name}</Text>
      </box>
    </box>
  )
}

function treeRowPath(rowKey: string): readonly [string, string] {
  return [SIDEBAR_TREE_AREA_ID, rowFocusId(rowKey)]
}

function rowFocusId(rowKey: string): string {
  return `row-${rowKey}`
}

function treePrefix(row: VisibleTreeNode): string {
  if (row.isExpandable) {
    return `${treeBaseIndent(row.level, row.parentIsLastPath)}${treeDisclosure(row)} `
  }

  return `${treeLeafIndent(row.level, row.parentIsLastPath)}${treeLeafLead(row)} `
}

function treeBaseIndent(level: number, parentIsLastPath: readonly boolean[]): string {
  let indent = "  "
  for (let i = 1; i <= level; i += 1) {
    if (i === 1) {
      indent += "  "
      continue
    }

    indent += (parentIsLastPath[i - 1] ?? true) ? "  " : `${GUIDE_PIPE} `
  }
  return indent
}

function treeDisclosure(row: Pick<VisibleTreeNode, "isExpandable" | "isExpanded">): string {
  if (!row.isExpandable) {
    return " "
  }
  return row.isExpanded ? EXPAND_OPEN : EXPAND_CLOSED
}

function treeLeafIndent(level: number, parentIsLastPath: readonly boolean[]): string {
  const base = treeBaseIndent(level + 1, parentIsLastPath)
  return base.slice(0, Math.max(0, base.length - 2))
}

function treeLeafLead(row: Pick<VisibleTreeNode, "level" | "isLast">): string {
  if (row.level === 0) {
    return "  "
  }
  return row.isLast ? LEAF_LAST : LEAF_MIDDLE
}

function treeIcon(row: Pick<VisibleTreeNode, "isExpandable" | "isExpanded" | "node">): string {
  if (row.isExpandable) {
    return row.isExpanded ? FOLDER_OPEN : FOLDER_CLOSED
  }

  switch (row.node.kind) {
    case "database":
      return "󰆼"
    case "schema":
      return "󰙅"
    case "table":
      return "󰓫"
    case "view":
    case "matview":
      return "󰈈"
    case "index":
      return "󰛦"
    case "trigger":
      return "󰐕"
    case "placeholder":
      return DEFAULT_FILE_ICON
    default:
      return DEFAULT_FILE_ICON
  }
}

function treeDisclosureOffset(row: Pick<VisibleTreeNode, "level" | "parentIsLastPath">): number {
  return textCells(treeBaseIndent(row.level, row.parentIsLastPath))
}

function textCells(text: string): number {
  return [...text].length
}

function isExpandableNode(node: TreeNode): boolean {
  return node.expandable === true || !!node.children?.length
}

function resolveExpansionState(
  nodes: TreeNode[],
  expansionOverrides: Record<string, boolean>,
): {
  allRowKeys: Set<string>
  allRowKeySignature: string
  expandedRowKeys: Set<string>
} {
  const allRowKeys = new Set<string>()
  const expandedRowKeys = new Set<string>()

  function visit(children: TreeNode[], parentPath = "") {
    for (const node of children) {
      const rowKey = parentPath ? `${parentPath}.${node.key}` : node.key
      allRowKeys.add(rowKey)

      if (isExpandableNode(node) && (expansionOverrides[rowKey] ?? node.expanded ?? false)) {
        expandedRowKeys.add(rowKey)
      }

      if (node.children?.length) {
        visit(node.children, rowKey)
      }
    }
  }

  visit(nodes)

  return {
    allRowKeys,
    allRowKeySignature: [...allRowKeys].sort().join("\n"),
    expandedRowKeys,
  }
}

function pruneExpansionOverrides(
  expansionOverrides: Record<string, boolean>,
  allRowKeys: Set<string>,
): Record<string, boolean> {
  let changed = false
  const next: Record<string, boolean> = {}

  for (const [rowKey, expanded] of Object.entries(expansionOverrides)) {
    if (!allRowKeys.has(rowKey)) {
      changed = true
      continue
    }
    next[rowKey] = expanded
  }

  return changed ? next : expansionOverrides
}

function flattenVisibleTree(
  nodes: TreeNode[],
  expandedRowKeys: ReadonlySet<string>,
  parentPath = "",
  level = 0,
  parentIsLastPath: boolean[] = [],
  parentRowKey?: string,
): VisibleTreeNode[] {
  const flat: VisibleTreeNode[] = []

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    const isLast = i === nodes.length - 1
    const rowKey = parentPath ? `${parentPath}.${node.key}` : node.key
    const isExpandable = isExpandableNode(node)
    const isExpanded = isExpandable && expandedRowKeys.has(rowKey)

    flat.push({
      node,
      rowKey,
      parentRowKey,
      level,
      isLast,
      isExpandable,
      isExpanded,
      parentIsLastPath,
    })

    if (isExpanded && node.children?.length) {
      flat.push(...flattenVisibleTree(node.children, expandedRowKeys, rowKey, level + 1, [...parentIsLastPath, isLast], rowKey))
    }
  }

  return flat
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
