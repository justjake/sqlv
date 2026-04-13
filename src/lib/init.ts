import { QueryClient } from "@tanstack/react-query"
import "./adapters/TursoAdapter"
import { getAdapter } from "./interface/Adapter"
import { Persist } from "./Persist"
import { QueryServiceImpl } from "./QueryServiceImpl"
import type { Environment } from "./types/Environment"
import { createId } from "./types/Id"
import { EpochMillis, type SessionLogEntry } from "./types/Log"
import { rowDispatcher } from "./types/RowStore"
import { unreachable } from "./types/unreachable"

export async function init(): Promise<Environment> {
  const session: SessionLogEntry = {
    id: createId(),
    type: "session",
    app: "sqlv",
    createdAt: EpochMillis.now(),
  }

  const connection = await Persist.defaultConnection()
  const adapter = getAdapter(connection.protocol)
  const executor = await adapter.connect(connection.config)
  const debugLogger = rowDispatcher((action) => {
    console.log(`log:`, action)
    switch (action.type) {
      case "get":
      case "update":
      case "delete":
        return Promise.resolve(undefined)
      case "insert":
      case "upsert":
        return Promise.resolve(action.row)
      case "query":
        return Promise.resolve([])
      default:
        unreachable(action)
    }
  })
  const persistDB = new QueryServiceImpl(session, connection, executor, debugLogger)
  const persist = new Persist(persistDB)
  await persist.migrate()

  const queryClient = new QueryClient()

  return { queryClient, session, persist }
}
