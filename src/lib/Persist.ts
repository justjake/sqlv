import { createRowStoreTableSql, createSqliteRowStore } from "./sqliteRowStore"
import type { Connection } from "./types/Connection"
import type { LogEntry } from "./types/Log"
import type { QueryRunner } from "./types/QueryRunner"
import type { RowStore } from "./types/RowStore"
import { ident } from "./types/SQL"

const CONNECTION_TABLE = ident("connection")
const LOG_TABLE = ident("log")

export class Persist {
  constructor(public readonly db: QueryRunner<{}>) {
    this.connections = createSqliteRowStore(this.db, CONNECTION_TABLE)
    this.log = createSqliteRowStore(this.db, LOG_TABLE)
  }

  async migrate() {
    await this.db.query(createRowStoreTableSql(CONNECTION_TABLE))
    await this.db.query(createRowStoreTableSql(LOG_TABLE))
  }

  connections: RowStore<Connection<any>>
  log: RowStore<LogEntry>
}
