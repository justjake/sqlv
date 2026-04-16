import type { Protocol } from "#spi/Adapter"
import type { EpochMillis } from "./Log"
import type { OrderString } from "./Order"

export type Connection<Config> = {
  type: "connection"
  id: string
  order: OrderString
  createdAt: EpochMillis
  protocol: Protocol
  name: string
  config: Config
}
