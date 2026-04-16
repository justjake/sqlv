import type { EpochMillis } from "./Log"
import type { OrderString } from "./Order"
import type { Protocol } from "./Protocol"

export type Connection<Config> = {
  type: "connection"
  id: string
  order: OrderString
  createdAt: EpochMillis
  protocol: Protocol
  name: string
  config: Config
}
