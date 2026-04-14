export { EpochMillis } from "./EpochMillis"
import type { EpochMillis } from "./EpochMillis"
import type { Json } from "./Json"
import type { RowStore } from "./RowStore"

export type QueryExecutionStatus = "pending" | "success" | "error" | "cancelled"

export type LogEntry = Session | ConnectLogEntry | FlowEntry | QueryExecution<any>

export type Session = {
  type: "session"
  id: string
  createdAt: EpochMillis
  app: string
}

export type SessionLogEntry = Session

export type QueryExecution<Row = object> = {
  type: "queryExecution"
  id: string
  connectionId: string
  sessionId: string
  database?: string
  schema?: string
  table?: string
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  sql: {
    source: string
    args: Array<Json>
  }
  sensitive: boolean
  flowId?: string
  status: QueryExecutionStatus
  finishedAt?: EpochMillis
  error?: string
  errorStack?: string
  rows: Row[]
  rowCount: number
  insertCount?: number
}

export type FlowEntry = {
  type: "flow"
  id: string
  connectionId: string
  sessionId: string
  createdAt: EpochMillis
  endedAt?: EpochMillis
  cancelled?: boolean
}

export type FlowLogEntry = FlowEntry

type ConnectLogEntry = {
  type: "connect"
  id: string
  connectionId: string
  sessionId: string
  createdAt: EpochMillis
  connectedAt: EpochMillis
}

export type LogStore = RowStore<LogEntry>
