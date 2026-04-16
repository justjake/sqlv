import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { epochMillis } from "./shared"

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    app: text("app").notNull(),
    createdAt: epochMillis("created_at").notNull(),
    endedAt: epochMillis("ended_at"),
  },
  (table) => [index("sessions_created_at_idx").on(table.createdAt)],
)

export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert
