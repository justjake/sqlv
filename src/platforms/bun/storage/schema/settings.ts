import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { SettingsId, SettingsSchema } from "#domain/Settings"
import { epochMillis, jsonText } from "./shared"

type StoredSettings = SettingsSchema[SettingsId]

export const settings = sqliteTable(
  "settings",
  {
    id: text("id").$type<SettingsId>().primaryKey(),
    settings: jsonText<StoredSettings>("settings").notNull(),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at"),
  },
  (table) => [index("settings_created_at_idx").on(table.createdAt)],
)

export type SettingsRow = typeof settings.$inferSelect
export type NewSettingsRow = typeof settings.$inferInsert
