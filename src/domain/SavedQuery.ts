import type { Protocol } from "#spi/Adapter"

import type { EpochMillis } from "./EpochMillis"
import type { MutableRowStore } from "./RowStore"

export type SavedQuery = {
  type: "savedQuery"
  id: string
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  name: string
  text: string
  protocol?: Protocol
}

export type SavedQueryStore = MutableRowStore<SavedQuery>
