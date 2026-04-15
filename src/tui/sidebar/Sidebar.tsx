import { useCallback, useState } from "react"
import type { ConnectionSuggestionsState, DiscoveredConnectionSuggestion } from "../../lib/SqlVisor"
import type { ObjectInfo, QueryableObjectInfo } from "../../lib/types/objects"
import { Focusable } from "../focus"
import { Shortcut } from "../Shortcut"
import { IconProvider, resolveIconStyle } from "../ui/icons"
import { Text } from "../ui/Text"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"
import { TreeView, type TreeNode } from "./TreeView"

type SidebarProps = {
  onAddConnection: (initialSuggestion?: DiscoveredConnectionSuggestion) => void
  onDeleteConnection?: (connectionId: string) => void | Promise<void>
  onToggleSettings?: () => void
  addConnectionEnabled?: boolean
  settingsEnabled?: boolean
}

export const SIDEBAR_AREA_ID = "sidebar"

export function Sidebar(props: SidebarProps) {
  const {
    addConnectionEnabled = true,
    onAddConnection,
    onDeleteConnection,
    onToggleSettings = () => undefined,
    settingsEnabled = true,
  } = props
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const connections = state.connections.data ?? []
  const iconStyle = resolveIconStyle(state.settings.appearance.useNerdFont)
  const [focusedConnectionId, setFocusedConnectionId] = useState<string | undefined>()
  const refreshConnectionId = focusedConnectionId

  const handleRefresh = useCallback(() => {
    if (!refreshConnectionId) {
      return
    }

    void engine.loadConnectionObjects(refreshConnectionId).catch(() => undefined)
  }, [engine, refreshConnectionId])

  const treeNodes: TreeNode[] = connections.map((connection) => {
    const connectionObjectsState = state.objectsByConnectionId[connection.id]
    const hasConnectionObjectsState = Object.hasOwn(state.objectsByConnectionId, connection.id)
    const connectionChildren = connectionObjectsState ? objectNodes(connection.id, connectionObjectsState) : undefined
    const collapsedDatabase = collapseSingleDatabaseNode(connectionChildren)

    return {
      key: connection.id,
      kind: "connection",
      connectionId: connection.id,
      expandable: true,
      expanded: connection.id === state.selectedConnectionId || hasConnectionObjectsState,
      name: connection.name,
      accessory: connection.protocol,
      inlineAccessory: collapsedDatabase?.name,
      inlineAccessoryIcon: collapsedDatabase ? "database" : undefined,
      inlineAccessorySeparator: collapsedDatabase ? true : undefined,
      children: collapsedDatabase?.children ?? connectionChildren,
    }
  })
  const suggestionSection = connectionSuggestionSection(state.connectionSuggestions)
  const sidebarNodes = suggestionSection ? [...treeNodes, suggestionSection] : treeNodes

  return (
    <Focusable
      childrenNavigable={false}
      delegatesFocus
      focusSelf
      focusable
      flexDirection="column"
      flexGrow={1}
      focusableId={SIDEBAR_AREA_ID}
      navigable
      position="relative"
    >
      <box columnGap={1} flexDirection="row" flexWrap="wrap" paddingBottom={1} rowGap={0}>
        <Shortcut global keys="ctrl+n" label="Add Conn" enabled={addConnectionEnabled} onKey={() => onAddConnection()} />
        <Shortcut global keys="ctrl+," label="Settings" enabled={settingsEnabled} onKey={onToggleSettings} />
        <Shortcut keys="r" label="Refresh" enabled={!!refreshConnectionId} onKey={handleRefresh} />
      </box>
      {state.connections.fetchStatus === "fetching" && connections.length === 0 && <Text>Loading connections...</Text>}
      {state.connections.status === "error" && connections.length === 0 && (
        <Text>{state.connections.error?.message}</Text>
      )}
      {state.connections.status === "success" && sidebarNodes.length === 0 && (
        <Text>No connections yet. Use the public API or add one next.</Text>
      )}
      <IconProvider style={iconStyle}>
        <TreeView
          focusableProps={{ navigable: false }}
          nodes={sidebarNodes}
          onBackspace={(_idx, node) => {
            if (node.kind === "connection" && node.connectionId) {
              void onDeleteConnection?.(node.connectionId)
            }
          }}
          onFocus={(_idx, node) => {
            setFocusedConnectionId((current) => (current === node.connectionId ? current : node.connectionId))
          }}
          onExpand={(_idx, node) => onOpenNode(engine, node)}
          onSelect={(_idx, node) => {
            if (node.suggestion) {
              onAddConnection(node.suggestion)
              return
            }

            onSelectNode(engine, node)
          }}
        />
      </IconProvider>
    </Focusable>
  )
}

export function onOpenNode(engine: ReturnType<typeof useSqlVisor>, node: TreeNode) {
  if (node.connectionId) {
    engine.selectConnection(node.connectionId)
  }
}

export function onSelectNode(engine: ReturnType<typeof useSqlVisor>, node: TreeNode) {
  if (node.connectionId) {
    engine.selectConnection(node.connectionId)
  }
}

export function objectNodes(
  connectionId: string,
  state: ReturnType<typeof useSqlVisorState>["objectsByConnectionId"][string] | undefined,
): TreeNode[] {
  if (!state || (state.status === "pending" && !state.data)) {
    return [{ key: `${connectionId}.idle`, kind: "placeholder", connectionId, name: "(loading objects...)" }]
  }
  if (state.fetchStatus === "fetching" && !state.data) {
    return [{ key: `${connectionId}.loading`, kind: "placeholder", connectionId, name: "(loading objects...)" }]
  }
  if (state.status === "error" && !state.data?.length) {
    return [
      {
        key: `${connectionId}.error`,
        kind: "placeholder",
        connectionId,
        name: state.error?.message ?? "(failed to load objects)",
      },
    ]
  }
  if (state.status !== "success") {
    return [{ key: `${connectionId}.pending`, kind: "placeholder", connectionId, name: "(loading objects...)" }]
  }
  const objects = state.data ?? []
  if (objects.length === 0) {
    return []
  }

  const entries = objects.map((object, index) => createObjectTreeEntry(connectionId, object, index))
  const entryById = new Map(entries.map((entry) => [entry.nodeId, entry]))
  const roots: MutableObjectTreeNode[] = []

  for (const entry of entries) {
    const parent = entry.parentIds
      .map((parentId) => entryById.get(parentId))
      .find((candidate): candidate is ObjectTreeEntry => candidate !== undefined)

    if (parent) {
      parent.node.children.push(entry.node)
      continue
    }

    roots.push(entry.node)
  }

  sortObjectTreeNodes(roots)
  return roots.map(finalizeObjectTreeNode)
}

export function objectLabel(object: ObjectInfo): string {
  switch (object.type) {
    case "database":
      return object.name
    case "schema":
      return `schema ${object.name}`
    case "table":
      return object.name
    case "view":
      return `view ${object.name}`
    case "matview":
      return `matview ${object.name}`
    case "index":
      return object.name
    case "trigger":
      return `trigger on ${object.on.name}`
  }
}

type MutableObjectTreeNode = Omit<TreeNode, "children"> & {
  children: MutableObjectTreeNode[]
}

type ObjectTreeEntry = {
  nodeId: string
  node: MutableObjectTreeNode
  parentIds: string[]
}

const MISSING_OBJECT_PARENT_KEY = "<none>"

function createObjectTreeEntry(connectionId: string, object: ObjectInfo, index: number): ObjectTreeEntry {
  const nodeId = objectNodeId(object, index)
  const defaultExpanded = objectDefaultExpanded(object)

  return {
    nodeId,
    node: {
      key: nodeId,
      connectionId,
      kind: object.type,
      accessory: objectAccessory(object),
      automatic: object.automatic,
      name: objectLabel(object),
      ...(defaultExpanded === undefined ? {} : { expanded: defaultExpanded }),
      children: [],
    },
    parentIds: objectParentIds(object),
  }
}

function finalizeObjectTreeNode(node: MutableObjectTreeNode): TreeNode {
  const { children, ...treeNode } = node

  if (children.length === 0) {
    return treeNode
  }

  return {
    ...treeNode,
    children: children.map(finalizeObjectTreeNode),
  }
}

function objectParentIds(object: ObjectInfo): string[] {
  switch (object.type) {
    case "database":
      return []
    case "schema":
      return object.database ? [databaseNodeId(object.database)] : []
    case "table":
    case "view":
    case "matview":
      return [
        ...(object.schema ? [schemaNodeId(object.database, object.schema)] : []),
        ...(object.database ? [databaseNodeId(object.database)] : []),
      ]
    case "index":
    case "trigger":
      return [
        queryableNodeId(object.on),
        ...(object.on.schema ? [schemaNodeId(object.on.database, object.on.schema)] : []),
        ...(object.on.database ? [databaseNodeId(object.on.database)] : []),
      ]
  }
}

function objectNodeId(object: ObjectInfo, index: number): string {
  switch (object.type) {
    case "database":
      return databaseNodeId(object.name)
    case "schema":
      return schemaNodeId(object.database, object.name)
    case "table":
    case "view":
    case "matview":
      return queryableNodeId(object)
    case "index":
      return `index:${queryableNodeId(object.on)}:${object.name}:${index}`
    case "trigger":
      return `trigger:${queryableNodeId(object.on)}:${index}`
  }
}

function objectDefaultExpanded(object: ObjectInfo): boolean | undefined {
  switch (object.type) {
    case "database":
    case "schema":
      return true
    case "table":
      return false
    case "view":
    case "matview":
    case "index":
    case "trigger":
      return undefined
  }
}

function databaseNodeId(name: string): string {
  return `database:${name}`
}

function schemaNodeId(database: string | undefined, name: string): string {
  return `schema:${database ?? MISSING_OBJECT_PARENT_KEY}:${name}`
}

function queryableNodeId(object: QueryableObjectInfo): string {
  return `${object.type}:${object.database ?? MISSING_OBJECT_PARENT_KEY}:${object.schema ?? MISSING_OBJECT_PARENT_KEY}:${object.name}`
}

function objectAccessory(object: ObjectInfo): string | undefined {
  switch (object.type) {
    case "database":
      return "db"
    case "table":
      return "tbl"
    case "index":
      return "idx"
    case "schema":
    case "view":
    case "matview":
    case "trigger":
      return undefined
  }
}

function sortObjectTreeNodes(nodes: MutableObjectTreeNode[]) {
  nodes.sort((a, b) => Number(a.automatic === true) - Number(b.automatic === true))

  for (const node of nodes) {
    if (node.children.length > 0) {
      sortObjectTreeNodes(node.children)
    }
  }
}

function collapseSingleDatabaseNode(nodes: TreeNode[] | undefined): TreeNode | undefined {
  if (nodes?.length !== 1) {
    return undefined
  }

  const [singleNode] = nodes
  return singleNode?.kind === "database" ? singleNode : undefined
}

function connectionSuggestionSection(state: ConnectionSuggestionsState): TreeNode | undefined {
  const children =
    state.status === "error"
      ? [{ key: "error", kind: "placeholder", name: state.error?.message ?? "(failed to scan suggestions)" }]
      : state.fetchStatus === "fetching" && (state.data?.length ?? 0) === 0
        ? [{ key: "loading", kind: "placeholder", name: "(scanning...)" }]
        : (state.data ?? []).map((suggestion) => ({
            key: suggestion.id,
            kind: "connectionSuggestion",
            name: suggestion.name,
            accessory: suggestion.protocol,
            suggestion,
          }))

  if (children.length === 0) {
    return undefined
  }

  return {
    key: "suggestions",
    automatic: true,
    children,
    expanded: true,
    name: "Suggestions",
  }
}
