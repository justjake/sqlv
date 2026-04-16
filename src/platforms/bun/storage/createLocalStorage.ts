import { QueryRunnerImpl } from "../../../engine/runtime/QueryRunnerImpl"
import { createNoopLogStore } from "../../../engine/runtime/createNoopLogStore"
import type { Connection } from "../../../domain/Connection"
import { createId } from "../../../domain/Id"
import { EpochMillis, type Session } from "../../../domain/Log"
import { OrderString } from "../../../domain/Order"
import type { AdapterRegistry, ProtocolConfig } from "../../../spi/Adapter"
import type { TursoConfig } from "../../../adapters/sqlite/turso/TursoAdapter"
import { DEFAULT_SQLVISOR_APP, defaultStoragePath } from "../paths"
import { Storage } from "./Storage"

const APP_NAME = DEFAULT_SQLVISOR_APP
const BUNDLE_ID = `tl.jake.${APP_NAME}`

export type SecretRef = { service: string; name: string }

/** https://bun.com/docs/runtime/secrets#api */
export type SecretStore = {
  get: (args: SecretRef) => Promise<string | null>
  set: (args: SecretRef & { value: string }) => Promise<void>
  delete: (args: SecretRef) => Promise<boolean>
}

export type StorageStore = Pick<Storage, "connections" | "log" | "savedQueries" | "settings" | "appState">
export type LocalStorage = {
  session: Session
  storage: StorageStore
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

export function defaultStorageLocation(app = APP_NAME) {
  return defaultStoragePath(app)
}

function defaultSecretName(app = APP_NAME): string {
  return `${APP_NAME}_${app}_encryption_key`
}

async function getExistingLocalEncryptionKey(
  secrets = defaultSecretStore(),
  app = APP_NAME,
): Promise<string | undefined> {
  try {
    return (
      (await secrets.get({
        service: BUNDLE_ID,
        name: defaultSecretName(app),
      })) ?? undefined
    )
  } catch {
    return undefined
  }
}

async function getOrCreateLocalEncryptionKey(secrets: SecretStore, app = APP_NAME): Promise<string> {
  let key = await getExistingLocalEncryptionKey(secrets, app)
  if (!key) {
    key = crypto.getRandomValues(Buffer.alloc(32)).toString("hex")
    await secrets.set({
      service: BUNDLE_ID,
      name: defaultSecretName(app),
      value: key,
    })
  }
  return key
}

export async function createLocalStorageConnection(
  args: {
    app?: string
    dbPath?: string
    secrets?: SecretStore
  } = {},
): Promise<Connection<TursoConfig>> {
  const app = args.app ?? APP_NAME
  const secrets = args.secrets ?? defaultSecretStore()
  const persistPath = args.dbPath ?? defaultStorageLocation(app)
  const config: ProtocolConfig<"turso"> = {
    path: persistPath,
    encryption: {
      cipher: "aegis256",
      hexkey: await getOrCreateLocalEncryptionKey(secrets, app),
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

export async function createLocalStorage(args: {
  app?: string
  dbPath?: string
  registry: AdapterRegistry
  session?: Session
  connection?: Connection<any>
  secrets?: SecretStore
}): Promise<LocalStorage> {
  const app = args.app ?? APP_NAME
  const session = args.session ?? createSession(app)
  const connection =
    args.connection ??
    (await createLocalStorageConnection({
      app,
      dbPath: args.dbPath,
      secrets: args.secrets ?? defaultSecretStore(),
    }))
  const adapter = args.registry.get(connection.protocol)
  const executor = await adapter.connect(connection.config)
  const storageDB = new QueryRunnerImpl(session, connection, executor, createNoopLogStore())
  const storage = new Storage(storageDB)
  await storage.migrate()
  return {
    session,
    storage,
  }
}

export async function getExistingLocalStorageEncryptionKey(
  secrets = defaultSecretStore(),
  app = APP_NAME,
): Promise<string | undefined> {
  return getExistingLocalEncryptionKey(secrets, app)
}

export async function getOrCreateLocalStorageEncryptionKey(secrets: SecretStore, app = APP_NAME): Promise<string> {
  return getOrCreateLocalEncryptionKey(secrets, app)
}
