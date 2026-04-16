import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"

import type { Protocol } from "#domain/Protocol"

import { epochMillis } from "./shared"

export const savedQueries = sqliteTable(
  "saved_queries",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    text: text("text").notNull(),
    protocol: text("protocol").$type<Protocol>(),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at"),
  },
  (table) => [
    index("saved_queries_created_at_idx").on(table.createdAt),
    index("saved_queries_protocol_idx").on(table.protocol),
  ],
)

export type SavedQueryRow = typeof savedQueries.$inferSelect
export type NewSavedQueryRow = typeof savedQueries.$inferInsert
