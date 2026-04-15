import { createRowStoreTableSql, createSqliteRowStore } from "./sqliteRowStore"
import type { Connection } from "./types/Connection"
import type { LogEntry } from "./types/Log"
import type { QueryRunner } from "./types/QueryRunner"
import type { SavedQuery } from "./types/SavedQuery"
import type { SettingsStore } from "./types/Settings"
import type { RowStore } from "./types/RowStore"
import { ident } from "./types/SQL"

const CONNECTION_TABLE = ident("connection")
const LOG_TABLE = ident("log")
const SAVED_QUERY_TABLE = ident("saved_query")
const SETTINGS_TABLE = ident("settings")

export class Persist {
  constructor(public readonly db: QueryRunner<{}>) {
    this.connections = createSqliteRowStore(this.db, CONNECTION_TABLE)
    this.log = createSqliteRowStore(this.db, LOG_TABLE)
    this.savedQueries = createSqliteRowStore(this.db, SAVED_QUERY_TABLE)
    this.settings = createSqliteRowStore(this.db, SETTINGS_TABLE)
  }

  async migrate() {
    await this.db.query(createRowStoreTableSql(CONNECTION_TABLE))
    await this.db.query(createRowStoreTableSql(LOG_TABLE))
    await this.db.query(createRowStoreTableSql(SAVED_QUERY_TABLE))
    await this.db.query(createRowStoreTableSql(SETTINGS_TABLE))
  }

  connections: RowStore<Connection<any>>
  log: RowStore<LogEntry>
  savedQueries: RowStore<SavedQuery>
  settings: SettingsStore
}
