import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Json } from "../../../../domain/Json"
import { OrderString, type OrderString as OrderStringType } from "../../../../domain/Order"
import type { Protocol } from "../../../../spi/Adapter"
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
