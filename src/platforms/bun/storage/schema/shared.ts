import { integer, text } from "drizzle-orm/sqlite-core"
import type { EpochMillis } from "../../../../domain/EpochMillis"
import type { Json } from "../../../../domain/Json"

export function epochMillis(name: string) {
  return integer(name, { mode: "number" }).$type<EpochMillis>()
}

export function jsonText<T extends Json = Json>(name: string) {
  return text(name, { mode: "json" }).$type<T>()
}
