import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Json } from "#domain/Json"
import type { QueryInitiator } from "#domain/Log"
import { epochMillis, jsonText } from "./shared"

export type AuditEventPayload = Record<string, Json>

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    createdAt: epochMillis("created_at").notNull(),
    kind: text("kind").notNull(),
    initiator: text("initiator").$type<QueryInitiator>().notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    connectionId: text("connection_id"),
    savedQueryId: text("saved_query_id"),
    queryExecutionId: text("query_execution_id"),
    payload: jsonText<AuditEventPayload>("payload").notNull(),
  },
  (table) => [
    index("audit_events_connection_id_idx").on(table.connectionId),
    index("audit_events_created_at_idx").on(table.createdAt),
    index("audit_events_kind_idx").on(table.kind),
    index("audit_events_query_execution_id_idx").on(table.queryExecutionId),
    index("audit_events_saved_query_id_idx").on(table.savedQueryId),
    index("audit_events_session_id_idx").on(table.sessionId),
  ],
)

export type AuditEventRow = typeof auditEvents.$inferSelect
export type NewAuditEventRow = typeof auditEvents.$inferInsert
