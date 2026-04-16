import type { Connection } from "./types/Connection"
import type { QueryExecution } from "./types/Log"
import type { SavedQuery } from "./types/SavedQuery"

export function findLatestSavedQueryExecution(
  savedQuery: SavedQuery,
  history: QueryExecution[],
  connections: Connection<any>[],
): QueryExecution | undefined {
  const protocolByConnectionId = new Map(connections.map((connection) => [connection.id, connection.protocol]))

  return (
    history.find((entry) => entry.savedQueryId === savedQuery.id) ??
    history.find(
      (entry) =>
        entry.sql.source === savedQuery.text &&
        (savedQuery.protocol === undefined || protocolByConnectionId.get(entry.connectionId) === savedQuery.protocol),
    )
  )
}
