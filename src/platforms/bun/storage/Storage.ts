import type { AppStateStore } from "#domain/AppState"
import { createRowStoreTableSql, createSqliteRowStore } from "./sqliteRowStore"
import type { Connection } from "#domain/Connection"
import type { LogEntry } from "#domain/Log"
import type { RowStore } from "#domain/RowStore"
import type { SavedQuery } from "#domain/SavedQuery"
import type { SettingsStore } from "#domain/Settings"
import { ident } from "#domain/SQL"
import type { QueryRunner } from "#spi/QueryRunner"

const CONNECTION_TABLE = ident("connection")
const LOG_TABLE = ident("log")
const SAVED_QUERY_TABLE = ident("saved_query")
const SETTINGS_TABLE = ident("settings")
const APP_STATE_TABLE = ident("app_state")

export class Storage {
  constructor(public readonly db: QueryRunner<any>) {
    this.connections = createSqliteRowStore(this.db, CONNECTION_TABLE)
    this.log = createSqliteRowStore(this.db, LOG_TABLE)
    this.savedQueries = createSqliteRowStore(this.db, SAVED_QUERY_TABLE)
    this.settings = createSqliteRowStore(this.db, SETTINGS_TABLE)
    this.appState = createSqliteRowStore(this.db, APP_STATE_TABLE)
  }

  async migrate() {
    await this.db.query(createRowStoreTableSql(CONNECTION_TABLE))
    await this.db.query(createRowStoreTableSql(LOG_TABLE))
    await this.db.query(createRowStoreTableSql(SAVED_QUERY_TABLE))
    await this.db.query(createRowStoreTableSql(SETTINGS_TABLE))
    await this.db.query(createRowStoreTableSql(APP_STATE_TABLE))
  }

  connections: RowStore<Connection<any>>
  log: RowStore<LogEntry>
  savedQueries: RowStore<SavedQuery>
  settings: SettingsStore
  appState: AppStateStore
}
