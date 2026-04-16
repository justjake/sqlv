import type { AppStateStore } from "#domain/AppState"
import type { Connection } from "#domain/Connection"
import type { LogStore } from "#domain/Log"
import type { MutableRowStore } from "#domain/RowStore"
import type { SavedQuery } from "#domain/SavedQuery"
import type { SettingsStore } from "#domain/Settings"

import type { StorageDatabase } from "./boot"
import { createAppStateStore } from "./repositories/appState"
import { createConnectionsStore } from "./repositories/connections"
import { createLogStore } from "./repositories/log"
import { createSavedQueriesStore } from "./repositories/savedQueries"
import { createSettingsStore } from "./repositories/settings"

export class Storage {
  constructor(public readonly db: StorageDatabase) {
    this.connections = createConnectionsStore(db)
    this.log = createLogStore(db)
    this.savedQueries = createSavedQueriesStore(db)
    this.settings = createSettingsStore(db)
    this.appState = createAppStateStore(db)
  }

  connections: MutableRowStore<Connection<any>>
  log: LogStore
  savedQueries: MutableRowStore<SavedQuery>
  settings: SettingsStore
  appState: AppStateStore
}
