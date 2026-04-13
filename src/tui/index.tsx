import { createCliRenderer, TextAttributes } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { sqlite } from "../lib/adapters/sqlite"
import { init } from "../lib/init"
import type { Connection } from "../lib/types/Connection"
import type { LogEntry } from "../lib/types/Log"
import { EnvProvider, useEnv } from "./useEnv"

export function App() {
  const env = useEnv()
  const { session, persist } = env
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => persist.connections.query((t) => sqlite<Connection<any>>`SELECT * FROM ${t}`),
  })
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => persist.log.query((t) => sqlite<LogEntry>`SELECT * FROM ${t}`),
  })
  useEffect(() => {
    persist.log.insert(session)
  }, [session, persist])
  return (
    <box alignItems="center" justifyContent="center" flexGrow={1}>
      <box justifyContent="center" alignItems="flex-end">
        <ascii-font font="tiny" text="OpenTUI" />
        <text>
          Session: {session.id} @ {new Date(session.createdAt).toLocaleString()}
        </text>
        <text>Sessions: {sessions.data?.length ?? "(loading...)"}</text>
        {sessions.data?.map((s) => (
          <text key={s.id}>
            {s.id} @ {new Date(s.createdAt).toLocaleString()}
          </text>
        ))}
        <text>Connections: {connections.data?.length ?? "(loading...)"}</text>
        {connections.data?.map((c) => (
          <text key={c.id}>{c.name}</text>
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
