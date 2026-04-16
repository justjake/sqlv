import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { Json } from "#domain/Json"

import { epochMillis, jsonText } from "./shared"

export const appState = sqliteTable(
  "app_state",
  {
    id: text("id").primaryKey(),
    value: jsonText<Json>("value").notNull(),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at"),
  },
  (table) => [index("app_state_created_at_idx").on(table.createdAt)],
)

export type AppStateRow = typeof appState.$inferSelect
export type NewAppStateRow = typeof appState.$inferInsert
