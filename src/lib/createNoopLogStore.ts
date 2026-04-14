import type { LogEntry } from "./types/Log"
import { rowDispatcher, type RowAction } from "./types/RowStore"
import { unreachable } from "./types/unreachable"

export function createNoopLogStore() {
  return rowDispatcher<LogEntry>(async <T extends LogEntry>(action: RowAction<T>): Promise<T | T[] | undefined> => {
    switch (action.type) {
      case "query":
        return []
      case "get":
        return undefined
      case "insert":
      case "upsert":
        return action.row
      case "update":
      case "delete":
        return undefined
      default:
        unreachable(action)
    }
  })
}
