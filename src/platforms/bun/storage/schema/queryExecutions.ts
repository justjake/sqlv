import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Json } from "../../../../domain/Json"
import type { QueryExecutionStatus, QueryInitiator } from "../../../../domain/Log"
import type { Protocol } from "../../../../spi/Adapter"
import { epochMillis, jsonText } from "./shared"

export type QueryExecutionSqlArgs = Json[]
export type QueryExecutionRowData = Record<string, Json>
export type QueryExecutionResultData = {
  rows: QueryExecutionRowData[]
  columns?: string[]
}

export const queryExecutions = sqliteTable(
  "query_executions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    connectionId: text("connection_id").notNull(),
    savedQueryId: text("saved_query_id"),
    connectionName: text("connection_name").notNull(),
    connectionProtocol: text("connection_protocol").$type<Protocol>().notNull(),
    initiator: text("initiator").$type<QueryInitiator>().notNull(),
    parentFlowId: text("parent_flow_id"),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at"),
    finishedAt: epochMillis("finished_at"),
    databaseName: text("database_name"),
    schemaName: text("schema_name"),
    tableName: text("table_name"),
    sqlSource: text("sql_source").notNull(),
    sqlArgs: jsonText<QueryExecutionSqlArgs>("sql_args").notNull(),
    sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<QueryExecutionStatus>().notNull(),
    rowCount: integer("row_count", { mode: "number" }).notNull().default(0),
    insertCount: integer("insert_count", { mode: "number" }),
    error: text("error"),
    errorStack: text("error_stack"),
    resultData: jsonText<QueryExecutionResultData>("result_data"),
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
