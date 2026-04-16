import type { Connection } from "#domain/Connection"
import { EpochMillis, type Session } from "#domain/Log"
import { OrderString } from "#domain/Order"
import type { ProtocolConfig } from "#spi/Adapter"

import type { TursoConfig } from "#adapters/sqlite/turso/TursoAdapter"
import { DEFAULT_SQLVISOR_APP } from "#platforms/bun/paths"

import {
  bootLocalStorage,
  createStorageSession,
  defaultSecretStore,
  defaultStoragePath,
  getExistingLocalStorageEncryptionKey as getExistingStorageEncryptionKey,
  getOrCreateLocalStorageEncryptionKey as getOrCreateStorageEncryptionKey,
  type SecretStore,
} from "./boot"
import { Storage } from "./Storage"

export { type SecretRef } from "./boot"
export { defaultSecretStore }

const APP_NAME = DEFAULT_SQLVISOR_APP

export type StorageStore = Pick<Storage, "connections" | "log" | "savedQueries" | "settings" | "appState">
export type LocalStorage = {
  close?: () => void
  session: Session
  storage: StorageStore
}

export function createSession(app = APP_NAME) {
  return createStorageSession(app)
}

export function defaultStorageLocation(app = APP_NAME) {
  return defaultStoragePath(app)
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
      hexkey: await getOrCreateStorageEncryptionKey(secrets, app),
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
  allowDestructiveMigration?: boolean
  app?: string
  dbPath?: string
  encryptionKey?: string
  secrets?: SecretStore
  session?: Session
} = {}): Promise<LocalStorage> {
  const app = args.app ?? APP_NAME
  const boot = await bootLocalStorage({
    allowDestructiveMigration: args.allowDestructiveMigration,
    app,
    dbPath: args.dbPath,
    encryptionKey: args.encryptionKey,
    secrets: args.secrets ?? defaultSecretStore(),
    session: args.session,
  })
  const storage = new Storage(boot.db)

  return {
    close: boot.close,
    session: boot.session,
    storage,
  }
}

export async function getExistingLocalStorageEncryptionKey(
  secrets = defaultSecretStore(),
  app = APP_NAME,
): Promise<string | undefined> {
  return getExistingStorageEncryptionKey(secrets, app)
}

export async function getOrCreateLocalStorageEncryptionKey(secrets: SecretStore, app = APP_NAME): Promise<string> {
  return getOrCreateStorageEncryptionKey(secrets, app)
}
