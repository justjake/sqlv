import type { ObjectInfo } from "../../lib/types/objects"
import { Shortcut } from "../Shortcut"
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
    name: `${connection.name} (${connection.protocol})`,
    children:
      connection.id === state.selectedConnectionId
        ? objectNodes(connection.id, state.objectsByConnectionId[connection.id])
        : undefined,
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1} paddingBottom={1}>
        <Shortcut keys="ctrl+n" label="Add Conn" enabled onKey={onAddConnection} />
      </box>
      {state.connections.fetchStatus === "fetching" && connections.length === 0 && <text>Loading connections...</text>}
      {state.connections.status === "error" && connections.length === 0 && (
        <text>{state.connections.error?.message}</text>
      )}
      {state.connections.status === "success" && treeNodes.length === 0 && (
        <text>No connections yet. Use the public API or add one next.</text>
      )}
      <TreeView nodes={treeNodes} onEnter={(_idx, node) => onEnterNode(engine, node)} />
    </box>
  )
}

export function onEnterNode(engine: ReturnType<typeof useSqlVisor>, node: TreeNode) {
  if (node.kind === "connection" && node.connectionId) {
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
