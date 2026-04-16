import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { Json } from "#domain/Json"
import type { QueryExecutionStatus, QueryInitiator } from "#domain/Log"

import { epochMillis, jsonText } from "./shared"

export type QueryExecutionSqlArgs = Json[]
export type QueryExecutionRowData = Record<string, Json>

export const queryExecutions = sqliteTable(
  "query_executions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    connectionId: text("connection_id").notNull(),
    savedQueryId: text("saved_query_id"),
    initiator: text("initiator").$type<QueryInitiator>().notNull(),
    parentFlowId: text("parent_flow_id"),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at"),
    finishedAt: epochMillis("finished_at"),
    database: text("database"),
    schema: text("schema"),
    table: text("table"),
    sqlSource: text("sql_source").notNull(),
    sqlArgs: jsonText<QueryExecutionSqlArgs>("sql_args").notNull(),
    sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<QueryExecutionStatus>().notNull(),
    rowCount: integer("row_count", { mode: "number" }).notNull().default(0),
    insertCount: integer("insert_count", { mode: "number" }),
    error: text("error"),
    errorStack: text("error_stack"),
    rows: jsonText<QueryExecutionRowData[]>("rows").notNull(),
  },
  (table) => [
    index("query_executions_connection_id_idx").on(table.connectionId),
    index("query_executions_created_at_idx").on(table.createdAt),
    index("query_executions_saved_query_id_idx").on(table.savedQueryId),
    index("query_executions_session_id_idx").on(table.sessionId),
    index("query_executions_status_idx").on(table.status),
  ],
)

export type QueryExecutionRow = typeof queryExecutions.$inferSelect
export type NewQueryExecutionRow = typeof queryExecutions.$inferInsert
