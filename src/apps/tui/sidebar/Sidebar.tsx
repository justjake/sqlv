import { useCallback, useState } from "react"
import type { ConnectionSuggestionsState, DiscoveredConnectionSuggestion } from "../../../api/SqlVisor"
import { Focusable } from "../focus/Focusable"
import { getTuiPreferences } from "../preferences"
import { Shortcut } from "../Shortcut"
import { IconProvider } from "../ui/icons"
import { Text } from "../ui/Text"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"
import { buildObjectBrowserTree, type ObjectBrowserNode } from "./objectBrowserTree"
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
  const iconStyle = getTuiPreferences(state).iconStyle
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
    const connectionChildren = connectionObjectsState
      ? objectStateToSidebarTreeNodes(connection.id, connectionObjectsState)
      : undefined
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
        <Shortcut
          global
          keys="ctrl+n"
          label="Add Conn"
          enabled={addConnectionEnabled}
          onKey={() => onAddConnection()}
        />
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

function objectStateToSidebarTreeNodes(
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

  return buildObjectBrowserTree(objects).map((node) => objectBrowserNodeToSidebarTreeNode(connectionId, node))
}

function objectBrowserNodeToSidebarTreeNode(connectionId: string, node: ObjectBrowserNode): TreeNode {
  return {
    key: node.id,
    connectionId,
    kind: node.kind,
    accessory: node.badge,
    automatic: node.automatic,
    name: node.label,
    expanded: node.defaultExpanded,
    children: node.children.map((child) => objectBrowserNodeToSidebarTreeNode(connectionId, child)),
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
