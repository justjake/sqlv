import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Protocol } from "../../interface/Adapter"
import type { Json } from "../../types/Json"
import { OrderString, type OrderString as OrderStringType } from "../../types/Order"
import { epochMillis, jsonText } from "./shared"

export type ConnectionConfigData = Json

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    protocol: text("protocol").$type<Protocol>().notNull(),
    config: jsonText<ConnectionConfigData>("config").notNull(),
    order: text("sort_order").$type<OrderStringType>().notNull().default(OrderString("")),
    createdAt: epochMillis("created_at").notNull(),
    updatedAt: epochMillis("updated_at"),
  },
  (table) => [
    index("connections_created_at_idx").on(table.createdAt),
    index("connections_name_idx").on(table.name),
    index("connections_protocol_idx").on(table.protocol),
  ],
)

export type ConnectionRow = typeof connections.$inferSelect
export type NewConnectionRow = typeof connections.$inferInsert
