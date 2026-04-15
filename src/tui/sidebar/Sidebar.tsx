import type { ObjectInfo } from "../../lib/types/objects"
import { Shortcut } from "../Shortcut"
import { Text } from "../ui/Text"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"
import { TreeView, type TreeNode } from "./TreeView"

type SidebarProps = {
  onAddConnection: () => void
}

export function Sidebar(props: SidebarProps) {
  const { onAddConnection } = props
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const connections = state.connections.data ?? []

  const treeNodes: TreeNode[] = connections.map((connection) => ({
    key: connection.id,
    kind: "connection",
    connectionId: connection.id,
    expandable: true,
    expanded: connection.id === state.selectedConnectionId || !!state.objectsByConnectionId[connection.id],
    name: connection.name,
    accessory: connection.protocol,
    children:
      connection.id === state.selectedConnectionId || state.objectsByConnectionId[connection.id]
        ? objectNodes(connection.id, state.objectsByConnectionId[connection.id])
        : undefined,
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1} paddingBottom={1}>
        <Shortcut keys="ctrl+n" label="Add Conn" enabled onKey={onAddConnection} />
      </box>
      {state.connections.fetchStatus === "fetching" && connections.length === 0 && <Text>Loading connections...</Text>}
      {state.connections.status === "error" && connections.length === 0 && (
        <Text>{state.connections.error?.message}</Text>
      )}
      {state.connections.status === "success" && treeNodes.length === 0 && (
        <Text>No connections yet. Use the public API or add one next.</Text>
      )}
      <TreeView
        nodes={treeNodes}
        onExpand={(_idx, node) => onOpenNode(engine, node)}
        onSelect={(_idx, node) => onSelectNode(engine, node)}
      />
    </box>
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
  if (!state) {
    return [{ key: `${connectionId}.idle`, kind: "placeholder", name: "(loading objects...)" }]
  }
  if (state.fetchStatus === "fetching" && !state.data) {
    return [{ key: `${connectionId}.loading`, kind: "placeholder", name: "(loading objects...)" }]
  }
  if (state.status === "error" && !state.data?.length) {
    return [
      { key: `${connectionId}.error`, kind: "placeholder", name: state.error?.message ?? "(failed to load objects)" },
    ]
  }
  if (!state.data?.length) {
    return [{ key: `${connectionId}.empty`, kind: "placeholder", name: "(no objects found)" }]
  }
  return state.data.map((object, index) => ({
    key: `${connectionId}.${object.type}.${index}`,
    connectionId,
    kind: object.type,
    name: objectLabel(object),
  }))
}

export function objectLabel(object: ObjectInfo): string {
  switch (object.type) {
    case "database":
      return `db ${object.name}`
    case "schema":
      return `schema ${object.name}`
    case "table":
      return `table ${object.name}`
    case "view":
      return `view ${object.name}`
    case "matview":
      return `matview ${object.name}`
    case "index":
      return `index on ${object.on.name}`
    case "trigger":
      return `trigger on ${object.on.name}`
  }
}
