export { EpochMillis } from "./EpochMillis"
import type { EpochMillis } from "./EpochMillis"
import type { Json } from "./Json"
import type { MutableRowStore } from "./RowStore"

export type QueryExecutionStatus = "pending" | "success" | "error" | "cancelled"
export type QueryInitiator = "user" | "system"
export type QueryFlow = {
  id: string
  name: string
  initiator: QueryInitiator
  parentFlowId?: string
}

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
  savedQueryId?: string
  initiator: QueryInitiator
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
  parentFlowId?: string
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
  name: string
  initiator: QueryInitiator
  parentFlowId?: string
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

export type LogStore = MutableRowStore<LogEntry>
