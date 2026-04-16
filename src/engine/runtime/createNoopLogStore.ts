import type { LogEntry } from "../../domain/Log"
import { rowDispatcher, type RowAction } from "../../domain/RowStore"
import { unreachable } from "../../domain/unreachable"

export function createNoopLogStore() {
  return rowDispatcher<LogEntry>(async <T extends LogEntry>(action: RowAction<T>): Promise<T | T[] | undefined> => {
    switch (action.type) {
      case "list":
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
