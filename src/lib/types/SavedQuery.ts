import type { Protocol } from "../interface/Adapter"
import type { EpochMillis } from "./EpochMillis"
import type { RowStore } from "./RowStore"

export type SavedQuery = {
  type: "savedQuery"
  id: string
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  name: string
  text: string
  protocol?: Protocol
}

export type SavedQueryStore = RowStore<SavedQuery>
