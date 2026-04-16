import type { EpochMillis } from "./EpochMillis"
import type { RowStore } from "./RowStore"

export type SettingsSchema = {
  workspace: {
    lastSelectedConnectionId: string
  }
}

export type SettingsId = Extract<keyof SettingsSchema, string>

export type SettingsRow<Id extends SettingsId = SettingsId> = {
  type: "settings"
  id: Id
  createdAt: EpochMillis
  updatedAt?: EpochMillis
  settings: SettingsSchema[Id]
}

export type AnySettingsRow = {
  [Id in SettingsId]: SettingsRow<Id>
}[SettingsId]

export type SettingsState = {
  [Id in SettingsId]: SettingsSchema[Id]
}

export type SettingsStore = RowStore<AnySettingsRow>

export function defaultSettingsState(): SettingsState {
  return {
    workspace: {
      lastSelectedConnectionId: "",
    },
  }
}

export function createSettingsRow<Id extends SettingsId>(
  id: Id,
  settings: SettingsSchema[Id],
  createdAt: EpochMillis,
): SettingsRow<Id> {
  return {
    createdAt,
    id,
    settings,
    type: "settings",
  }
}
