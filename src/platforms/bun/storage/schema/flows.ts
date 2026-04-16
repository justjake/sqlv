import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { QueryInitiator } from "#domain/Log"

import { epochMillis } from "./shared"

export const flows = sqliteTable(
  "flows",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    connectionId: text("connection_id").notNull(),
    name: text("name").notNull(),
    initiator: text("initiator").$type<QueryInitiator>().notNull(),
    parentFlowId: text("parent_flow_id"),
    createdAt: epochMillis("created_at").notNull(),
    endedAt: epochMillis("ended_at"),
    cancelled: integer("cancelled", { mode: "boolean" }),
  },
  (table) => [
    index("flows_connection_id_idx").on(table.connectionId),
    index("flows_created_at_idx").on(table.createdAt),
    index("flows_session_id_idx").on(table.sessionId),
  ],
)

export type FlowRow = typeof flows.$inferSelect
export type NewFlowRow = typeof flows.$inferInsert
