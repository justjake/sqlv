import { createCliRenderer, TextAttributes } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useQuery } from "@tanstack/react-query"
import { sqlite } from "../lib/adapters/sqlite"
import { init } from "../lib/init"
import { EnvProvider, useEnv } from "./useEnv"

export function App() {
  const env = useEnv()
  const { session } = env
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => env.persist.connections.query((t) => sqlite`SELECT * FROM ${t}`),
  })
  return (
    <box alignItems="center" justifyContent="center" flexGrow={1}>
      <box justifyContent="center" alignItems="flex-end">
        <ascii-font font="tiny" text="OpenTUI" />
        <text>
          Session: ${session.id} @ {new Date(session.createdAt).toLocaleString()}
        </text>
        <text>Connections: ${connections.data?.length ?? "(loading...)"}</text>
        {connections.data?.map((c) => (
          <text>{c.name}</text>
        ))}
        <text attributes={TextAttributes.DIM}>What will you build?</text>
      </box>
    </box>
  )
}

if (import.meta.main) {
  const env = await init()
  const renderer = await createCliRenderer()
  createRoot(renderer).render(
    <EnvProvider value={env}>
      <App />
    </EnvProvider>,
  )
}
