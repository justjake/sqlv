import type { EpochMillis } from "./EpochMillis"
import type { Json } from "./Json"
import type { MutableRowStore } from "./RowStore"

export type AppStateId = string

export type AppStateRow<Value extends Json = Json> = {
  type: "appState"
  id: AppStateId
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  value: Value
}

export type AnyAppStateRow = AppStateRow<Json>
export type AppStateSnapshot = Record<AppStateId, Json>
export type AppStateStore = MutableRowStore<AnyAppStateRow>

export function defaultAppState(): AppStateSnapshot {
  return {}
}
