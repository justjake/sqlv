import * as os from "node:os"
import * as path from "node:path"
import type { TursoConfig } from "./adapters/TursoAdapter"
import { createNoopLogStore } from "./createNoopLogStore"
import { type AdapterRegistry, type ProtocolConfig } from "./interface/Adapter"
import { Persist } from "./Persist"
import { QueryRunnerImpl } from "./QueryRunnerImpl"
import type { Connection } from "./types/Connection"
import { createId } from "./types/Id"
import { EpochMillis, type Session } from "./types/Log"
import { OrderString } from "./types/Order"

const APP_NAME = "sqlv"
const BUNDLE_ID = `tl.jake.${APP_NAME}`
const ENCRYPTION_SECRET_DEFAULT_NAME = `${APP_NAME}_encryption_key`
const DB_NAME = `${APP_NAME}.db`

export type SecretRef = { service: string; name: string }

/** https://bun.com/docs/runtime/secrets#api */
export type SecretStore = {
  get: (args: SecretRef) => Promise<string | null>
  set: (args: SecretRef & { value: string }) => Promise<void>
  delete: (args: SecretRef) => Promise<boolean>
}

export type PersistenceStore = Pick<Persist, "connections" | "log">

export type LocalPersistence = {
  session: Session
  persist: PersistenceStore
}

export function createSession(app = APP_NAME): Session {
  return {
    id: createId(),
    type: "session",
    app,
    createdAt: EpochMillis.now(),
  }
}

export function defaultSecretStore(): SecretStore {
  return (Bun as any).secrets
}

export function defaultPersistLocation() {
  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  return path.join(xdgDataHome, APP_NAME, DB_NAME)
}

export async function getOrCreateLocalEncryptionKey(secrets: SecretStore): Promise<string> {
  let key = await secrets.get({
    service: BUNDLE_ID,
    name: ENCRYPTION_SECRET_DEFAULT_NAME,
  })
  if (!key) {
    key = crypto.getRandomValues(Buffer.alloc(32)).toString("hex")
    await secrets.set({
      service: BUNDLE_ID,
      name: ENCRYPTION_SECRET_DEFAULT_NAME,
      value: key,
    })
  }
  return key
}

export async function createLocalPersistenceConnection(
  secrets = defaultSecretStore(),
): Promise<Connection<TursoConfig>> {
  const persistPath = defaultPersistLocation()
  const config: ProtocolConfig<"turso"> = {
    path: persistPath,
    encryption: {
      cipher: "aegis256",
      hexkey: await getOrCreateLocalEncryptionKey(secrets),
    },
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

export async function createLocalPersistence(args: {
  registry: AdapterRegistry
  session?: Session
  connection?: Connection<any>
  secrets?: SecretStore
}): Promise<LocalPersistence> {
  const session = args.session ?? createSession()
  const connection = args.connection ?? (await createLocalPersistenceConnection(args.secrets ?? defaultSecretStore()))
  const adapter = args.registry.get(connection.protocol)
  const executor = await adapter.connect(connection.config)
  const persistDB = new QueryRunnerImpl(session, connection, executor, createNoopLogStore())
  const persist = new Persist(persistDB)
  await persist.migrate()
  return { session, persist }
}
