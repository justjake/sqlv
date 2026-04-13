import * as os from "node:os"
import * as path from "node:path"
import type { SqliteArg } from "./adapters/sqlite"
import type { TursoConfig } from "./adapters/TursoAdapter"
import type { ProtocolConfig } from "./interface/Adapter"
import { createRowStoreTableSql, createSqliteRowStore } from "./sqliteRowStore"
import type { Connection } from "./types/Connection"
import type { LogEntry } from "./types/Log"
import { EpochMillis } from "./types/Log"
import { OrderString } from "./types/Order"
import type { QueryService } from "./types/QueryService"
import type { RowStore } from "./types/RowStore"
import { ident } from "./types/SQL"

const APP_NAME = "sqlv"
const BUNDLE_ID = `tl.jake.${APP_NAME}`
const ENCRYPTION_SECRET_DEFAULT_NAME = `${APP_NAME}_encryption_key`
const DB_NAME = `${APP_NAME}.db`

type SecretRef = { service: string; name: string }

/** https://bun.com/docs/runtime/secrets#api */
type SecretStore = {
  get: (args: SecretRef) => Promise<string | null>
  set: (args: SecretRef & { value: string }) => Promise<void>
  delete: (args: SecretRef) => Promise<boolean>
}

export function defaultSecretStore(): SecretStore {
  return (Bun as any).secrets
}

function defaultPersistLocation() {
  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")

  return path.join(xdgDataHome, APP_NAME, DB_NAME)
}

export async function getOrCreateLocalEncryptionKey(secrets: SecretStore): Promise<string> {
  let key = await secrets.get({
    service: BUNDLE_ID,
    name: ENCRYPTION_SECRET_DEFAULT_NAME,
  })
  if (!key) {
    key = crypto.getRandomValues(Buffer.alloc(32)).toHex()
    await secrets.set({
      service: BUNDLE_ID,
      name: ENCRYPTION_SECRET_DEFAULT_NAME,
      value: key,
    })
  }
  return key
}

export type BaseRow = {
  id: string
  type: string
  createdAt: EpochMillis
  order?: string
  json?: {}
}

export type GenericRow<T> = BaseRow & { json: Omit<T, keyof BaseRow> }

export type RowEncoder<T, D> = {
  encode(row: T): GenericRow<D>
  decode(row: GenericRow<D>): T
}

const CONNECTION_TABLE = ident("connection")
const LOG_TABLE = ident("log")

export class Persist {
  static async defaultConnection(): Promise<Connection<TursoConfig>> {
    const secrets = defaultSecretStore()
    const path = defaultPersistLocation()
    const key = await getOrCreateLocalEncryptionKey(secrets)
    const config: ProtocolConfig<"turso"> = {
      path,
      // encryption: {
      //   cipher: "aegis256",
      //   hexkey: key,
      // },
    }

    return {
      id: "__persist__",
      type: "connection",
      name: APP_NAME,
      createdAt: EpochMillis.now(),
      order: OrderString(""),
      protocol: "turso",
      config,
    }
  }

  constructor(public readonly db: QueryService<{}, SqliteArg>) {
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
