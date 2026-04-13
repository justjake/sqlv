import type { Json } from "./Json"
import type { RowStore } from "./RowStore"

export type EpochMillis = number & { __epochMillis__: true }

export function EpochMillis(number: number): EpochMillis {
  return number as EpochMillis
}

EpochMillis.now = () => EpochMillis(Date.now())

export type LogEntry = SessionLogEntry | ConnectLogEntry | RequestLogEntry | ResponseLogEntry

export type SessionLogEntry = {
  type: "session"
  id: string
  createdAt: EpochMillis
  app: string
}

export type RequestLogEntry = {
  type: "req"
  id: string
  connectionId: string
  sessionId: string
  database?: string
  schema?: string
  table?: string
  createdAt: EpochMillis
  sql: {
    source: string
    args: Array<Json>
  }
  sensitive: boolean
  flowId?: string
}

export type ResponseLogEntry = {
  type: "res"
  id: string
  connectionId: string
  sessionId: string
  requestId: string
  createdAt: EpochMillis
  success: boolean
  error?: string
  cancelled: boolean
  rows: object[]
  rowCount: number
  insertCount?: number
  flowId?: string
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

type ConnectLogEntry = {
  type: "connect"
  id: string
  connectionId: string
  sessionId: string
  createdAt: EpochMillis
  connectedAt: EpochMillis
}

export type LogStore = RowStore<LogEntry>
