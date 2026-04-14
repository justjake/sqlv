import { useQuery } from "@tanstack/react-query"
import { sqlite } from "../../lib/adapters/sqlite"
import type { Connection } from "../../lib/types/Connection"
import { Shortcut } from "../Shortcut"
import { useEnv } from "../useEnv"
import { TreeView, type TreeNode } from "./TreeView"

type SidebarProps = {
  onAddConnection: () => void
  onSelectNode?: (node: TreeNode) => void
}

export function Sidebar(props: SidebarProps) {
  const { onAddConnection, onSelectNode } = props
  const { persist } = useEnv()

  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => persist.connections.query((t) => sqlite<Connection<any>>`SELECT * FROM ${t}`),
  })

  const treeNodes: TreeNode[] = (connections.data ?? []).map((conn) => ({
    key: conn.id,
    name: `${conn.name} (${conn.protocol})`,
    children: [
      // TODO: fetch via adapter.fetchObjects when connection is expanded
      // databases -> schemas -> tables/views/matviews
      { key: `${conn.id}.placeholder`, name: "(connect to browse)" },
    ],
  }))

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1} paddingBottom={1}>
        <Shortcut label="Add Conn" ctrl name="n" enabled onKey={onAddConnection} />
      </box>
      {connections.isLoading && <text>Loading...</text>}
      {treeNodes.length === 0 && !connections.isLoading && (
        <text>No connections. Press ^N to add one.</text>
      )}
      <TreeView
        nodes={treeNodes}
        onEnter={(_idx, node) => onSelectNode?.(node)}
      />
    </box>
  )
}
