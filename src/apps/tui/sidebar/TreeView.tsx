import { TextAttributes, type BoxRenderable } from "@opentui/core"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { focusPath, sameFocusPath } from "../../framework/focus/paths"
import type { DiscoveredConnectionSuggestion } from "#api/SqlVisor"
import { Focusable, type FocusableProps } from "../focus/Focusable"
import {
  useFocusedDescendantPath,
  useFocusPath,
  useFocusTree,
  useIsFocusNavigationActive,
  useIsFocusWithin,
  useRememberedDescendantPath,
} from "../focus/context"
import { useOpaqueIdMap } from "../focus/opaqueIds"
import { useIconGlyph, type IconName } from "../ui/icons"
import { useKeybind } from "../ui/keybind/useKeybind"
import { useNavKeys } from "../ui/keybind/useNavKeys"
import { useShortcut } from "../ui/keybind/useShortcut"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"

export type TreeNode = {
  key: string
  name: string
  accessory?: string
  accessoryIcon?: IconName
  accessoryPlacement?: "inline" | "right"
  accessorySeparator?: boolean
  inlineAccessory?: string
  inlineAccessoryIcon?: IconName
  inlineAccessorySeparator?: boolean
  automatic?: boolean
  kind?: string
  connectionId?: string
  suggestion?: DiscoveredConnectionSuggestion
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

export type TreeViewProps = {
  nodes: TreeNode[]
  onBackspace?: (idx: number, node: TreeNode) => void
  onFocus?: (idx: number, node: TreeNode) => void
  onExpand?: (idx: number, node: TreeNode) => void
  onSelect?: (idx: number, node: TreeNode) => void
  focusableProps?: Omit<Partial<FocusableProps>, "children" | "focusable" | "focusableId">
}

export const SIDEBAR_TREE_AREA_ID = "sidebar-tree"

const GUIDE_PIPE = "│"
const LEAF_LAST = "└"
const LEAF_MIDDLE = "│"

export function TreeView(props: TreeViewProps) {
  const { focusableProps, ...treeProps } = props

  return (
    <Focusable
      childrenNavigable={false}
      delegatesFocus
      focusSelf
      focusable
      flexDirection="column"
      focusableId={SIDEBAR_TREE_AREA_ID}
      {...focusableProps}
    >
      <TreeViewBody {...treeProps} />
    </Focusable>
  )
}

function TreeViewBody(props: Omit<TreeViewProps, "focusableProps">) {
  const { nodes, onBackspace, onExpand, onFocus, onSelect } = props
  const { inChordRef } = useKeybind()
  const tree = useFocusTree()
  const treePath = useFocusPath() ?? [SIDEBAR_TREE_AREA_ID]
  const [expansionOverrides, setExpansionOverrides] = useState<Record<string, boolean>>({})
  const expansionState = useMemo(() => resolveExpansionState(nodes, expansionOverrides), [nodes, expansionOverrides])
  const rows = useMemo(
    () => flattenVisibleTree(nodes, expansionState.expandedRowKeys),
    [expansionState.expandedRowKeys, nodes],
  )
  const rowKeys = useMemo(() => rows.map((row) => row.rowKey), [rows])
  const rowFocusIds = useOpaqueIdMap(rowKeys, "row")
  const rowPaths = useMemo(() => {
    const next = new Map<string, readonly string[]>()
    for (const rowKey of rowKeys) {
      const focusableId = rowFocusIds.get(rowKey)
      if (focusableId) {
        next.set(rowKey, focusPath(treePath, focusableId))
      }
    }
    return next
  }, [rowFocusIds, rowKeys, treePath])
  const focusedWithin = useIsFocusWithin(treePath)
  const navigationActive = useIsFocusNavigationActive()
  const focusedRowPath = useFocusedDescendantPath()
  const rememberedRowPath = useRememberedDescendantPath()
  const theme = useTheme()

  const focusedIndex = rows.findIndex((row) => sameFocusPath(focusedRowPath, rowPaths.get(row.rowKey)))
  const rememberedIndex = rows.findIndex((row) => sameFocusPath(rememberedRowPath, rowPaths.get(row.rowKey)))
  const currentIndex = focusedIndex >= 0 ? focusedIndex : rememberedIndex >= 0 ? rememberedIndex : 0
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
    const rowPath = row ? rowPaths.get(row.rowKey) : undefined
    if (!rowPath) {
      return
    }
    tree.focusPath(rowPath)
  }

  function focusCurrentRow() {
    if (currentIndex < 0) {
      return
    }
    focusRow(currentIndex)
  }

  function focusPrevRow() {
    if (focusedIndex < 0) {
      focusCurrentRow()
      return
    }
    focusRow(Math.max(0, currentIndex - 1))
  }

  function focusNextRow() {
    if (focusedIndex < 0) {
      focusCurrentRow()
      return
    }
    focusRow(Math.min(rows.length - 1, currentIndex + 1))
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
    const rowPath = rowPaths.get(row.rowKey)
    if (rowPath) {
      tree.focusPath(rowPath, "mouse")
    }
    toggleRow(row, rowIndex >= 0 ? rowIndex : currentIndex)
  }

  const shortcutsEnabled = !navigationActive && !inChordRef.current && focusedWithin && rows.length > 0
  const backspaceEnabled = !inChordRef.current && focusedWithin && rows.length > 0

  useNavKeys({
    enabled: shortcutsEnabled,
    handlers: {
      activate(key) {
        key.preventDefault()
        key.stopPropagation()
        toggleCurrentRow()
      },
      down(key) {
        key.preventDefault()
        key.stopPropagation()
        focusNextRow()
      },
      left(key) {
        if (currentRow?.isExpandable && currentRow.isExpanded) {
          key.preventDefault()
          key.stopPropagation()
          setRowExpanded(currentRow, false)
          return
        }
        if (currentRow?.parentRowKey) {
          key.preventDefault()
          key.stopPropagation()
          const parentRowPath = rowPaths.get(currentRow.parentRowKey)
          if (parentRowPath) {
            tree.focusPath(parentRowPath)
          }
        }
      },
      right(key) {
        if (currentRow?.isExpandable && !currentRow.isExpanded) {
          key.preventDefault()
          key.stopPropagation()
          setRowExpanded(currentRow, true)
        }
      },
      up(key) {
        key.preventDefault()
        key.stopPropagation()
        focusPrevRow()
      },
    },
  })

  useShortcut({
    enabled: backspaceEnabled && !!currentRow && !!onBackspace,
    keys: "backspace",
    onKey(key) {
      if (!currentRow) {
        return
      }

      key.preventDefault()
      key.stopPropagation()
      onBackspace?.(currentIndex, currentRow.node)
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
        const path = rowPaths.get(row.rowKey)
        const rowFocusId = rowFocusIds.get(row.rowKey)
        const focused = sameFocusPath(path, focusedRowPath)
        const remembered = !focusedWithin && sameFocusPath(path, rememberedRowPath)
        if (!path || !rowFocusId) {
          return null
        }
        return (
          <TreeRow
            key={row.rowKey}
            focusableId={rowFocusId}
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
  children: ReactNode
  focusableId: string
  onToggleDisclosure?: () => void
  row: VisibleTreeNode
}) {
  const { children, focusableId, onToggleDisclosure, row } = props
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
      <Focusable focusable focusableId={focusableId} navigable={false}>
        <box width="100%">{children}</box>
      </Focusable>
    </box>
  )
}

function TreeNodeView(
  props: VisibleTreeNode & {
    focused: boolean
    remembered: boolean
  },
) {
  const { focused, node, remembered } = props
  const theme = useTheme()
  const expandOpen = useIconGlyph("expandOpen")
  const expandClosed = useIconGlyph("expandClosed")
  const prefix = treePrefix(props, props.isExpanded ? expandOpen : expandClosed)
  const icon = useIconGlyph(treeIconName(props))
  const inlineAccessory = node.inlineAccessory ?? (node.accessoryPlacement === "inline" ? node.accessory : undefined)
  const inlineAccessoryIconName =
    node.inlineAccessoryIcon ?? (node.accessoryPlacement === "inline" ? node.accessoryIcon : undefined)
  const inlineAccessorySeparator =
    node.inlineAccessorySeparator ?? (node.accessoryPlacement === "inline" ? node.accessorySeparator : undefined)
  const rightAccessory = node.accessoryPlacement === "inline" ? undefined : node.accessory
  const rightAccessoryIconName = node.accessoryPlacement === "inline" ? undefined : node.accessoryIcon
  const rightAccessorySeparator = node.accessoryPlacement === "inline" ? undefined : node.accessorySeparator
  const inlineAccessoryIcon = useIconGlyph(inlineAccessoryIconName ?? "placeholder")
  const rightAccessoryIcon = useIconGlyph(rightAccessoryIconName ?? "placeholder")
  const showInlineAccessory = !!inlineAccessory
  const showRightAccessory = !!rightAccessory
  const dimAttributes = node.automatic ? TextAttributes.DIM : 0
  const labelFg = focused ? theme.formFieldLabelActiveFg : node.automatic ? theme.mutedFg : theme.primaryFg
  const prefixFg = focused ? theme.formFieldLabelActiveFg : theme.mutedFg
  const iconFg = focused ? theme.formFieldLabelActiveFg : node.automatic ? theme.mutedFg : theme.focusBg
  const accessoryFg = focused ? theme.formFieldLabelActiveFg : theme.mutedFg

  return (
    <box
      backgroundColor={focused ? theme.focusBg : remembered ? theme.inputBg : undefined}
      flexDirection="row"
      width="100%"
    >
      <box flexGrow={0} flexShrink={0} width={textCells(prefix)}>
        <Text fg={prefixFg} wrapMode="none">
          <span attributes={dimAttributes}>{prefix}</span>
        </Text>
      </box>
      <box flexGrow={0} flexShrink={0} width={textCells(icon)}>
        <Text fg={iconFg} wrapMode="none">
          <span attributes={dimAttributes}>{icon}</span>
        </Text>
      </box>
      <box flexGrow={0} flexShrink={0} width={1}>
        <Text fg={prefixFg} wrapMode="none">
          <span attributes={dimAttributes}> </span>
        </Text>
      </box>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text fg={labelFg} truncate wrapMode="none">
          <span attributes={dimAttributes}>{node.name}</span>
          {showInlineAccessory && (
            <>
              <span attributes={TextAttributes.DIM | dimAttributes} fg={accessoryFg}>
                {inlineAccessorySeparator ? (
                  <span attributes={TextAttributes.DIM | dimAttributes}>{`${expandClosed} `}</span>
                ) : (
                  ""
                )}
              </span>
              {inlineAccessoryIconName && (
                <span attributes={dimAttributes} fg={iconFg}>{`${inlineAccessoryIcon} `}</span>
              )}
              <span attributes={dimAttributes} fg={labelFg}>
                {inlineAccessory}
              </span>
            </>
          )}
        </Text>
      </box>
      {showRightAccessory && (
        <box flexGrow={0} flexShrink={100} minWidth={0}>
          <Text fg={accessoryFg} truncate wrapMode="none">
            <span attributes={TextAttributes.DIM | dimAttributes}>
              {rightAccessorySeparator ? "| " : ""}
              {rightAccessoryIconName ? `${rightAccessoryIcon} ` : ""}
              {rightAccessory}
            </span>
          </Text>
        </box>
      )}
    </box>
  )
}

function treePrefix(row: VisibleTreeNode, disclosure: string): string {
  if (row.isExpandable) {
    return `${treeBaseIndent(row.level, row.parentIsLastPath)}${disclosure} `
  }

  if (row.level === 0) {
    return ""
  }

  return `${treeLeafIndent(row.level, row.parentIsLastPath)}${treeLeafLead(row)} `
}

function treeBaseIndent(level: number, parentIsLastPath: readonly boolean[]): string {
  let indent = ""
  for (let i = 1; i <= level; i += 1) {
    if (i === 1) {
      indent += "  "
      continue
    }

    indent += (parentIsLastPath[i - 1] ?? true) ? "  " : `${GUIDE_PIPE} `
  }
  return indent
}

function treeLeafIndent(level: number, parentIsLastPath: readonly boolean[]): string {
  const base = treeBaseIndent(level + 1, parentIsLastPath)
  return base.slice(0, Math.max(0, base.length - 2))
}

function treeLeafLead(row: Pick<VisibleTreeNode, "level" | "isLast">): string {
  if (row.level === 0) {
    return ""
  }
  return row.isLast ? LEAF_LAST : LEAF_MIDDLE
}

function treeIconName(row: Pick<VisibleTreeNode, "isExpandable" | "isExpanded" | "node">): IconName {
  const semanticIcon = treeSemanticIconName(row.node.kind)
  if (semanticIcon) {
    return semanticIcon
  }

  if (row.isExpandable) {
    if (row.isExpanded && hasExplicitEmptyChildren(row.node)) {
      return "folderOpenEmpty"
    }
    return row.isExpanded ? "folderOpen" : "folder"
  }

  return "placeholder"
}

function treeSemanticIconName(kind: TreeNode["kind"]): IconName | undefined {
  switch (kind) {
    case "database":
    case "connectionSuggestion":
      return "database"
    case "schema":
      return "schema"
    case "table":
      return "table"
    case "view":
      return "view"
    case "matview":
      return "matview"
    case "index":
      return "index"
    case "trigger":
      return "trigger"
    case "placeholder":
      return "placeholder"
    default:
      return undefined
  }
}

function hasExplicitEmptyChildren(node: Pick<TreeNode, "children">): boolean {
  return Array.isArray(node.children) && node.children.length === 0
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
      flat.push(
        ...flattenVisibleTree(node.children, expandedRowKeys, rowKey, level + 1, [...parentIsLastPath, isLast], rowKey),
      )
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
