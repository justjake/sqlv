import { mkdir } from "node:fs/promises"
import * as path from "node:path"
import { pathToFileURL } from "node:url"

import { createClient, type Client } from "@libsql/client/node"
import { pushSQLiteSchema } from "drizzle-kit/api"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"

import { createId } from "#domain/Id"
import { EpochMillis, type Session } from "#domain/Log"

import { DEFAULT_SQLVISOR_APP, defaultStoragePath as resolveDefaultStoragePath } from "../paths"

import { appState } from "./schema/appState"
import { auditEvents } from "./schema/auditEvents"
import { connections } from "./schema/connections"
import { flows } from "./schema/flows"
import { queryExecutions } from "./schema/queryExecutions"
import { savedQueries } from "./schema/savedQueries"
import { sessions } from "./schema/sessions"
import { settings } from "./schema/settings"

const APP_NAME = DEFAULT_SQLVISOR_APP
const BUNDLE_ID = `tl.jake.${APP_NAME}`

export type SecretRef = { service: string; name: string }

/** https://bun.com/docs/runtime/secrets#api */
export type SecretStore = {
  get: (args: SecretRef) => Promise<string | null>
  set: (args: SecretRef & { value: string }) => Promise<void>
  delete: (args: SecretRef) => Promise<boolean>
}

export const storageSchema = {
  appState,
  auditEvents,
  connections,
  flows,
  queryExecutions,
  savedQueries,
  sessions,
  settings,
}

export type StorageSchema = typeof storageSchema
export type StorageDatabase = LibSQLDatabase<StorageSchema>

export type StorageMigration = {
  hasDataLoss: boolean
  statementsToExecute: string[]
  warnings: string[]
}

export type BootLocalStorageResult = {
  client: Client
  db: StorageDatabase
  dbPath: string
  migration: StorageMigration
  session: Session
  close: () => void
}

export class StorageMigrationError extends Error {
  constructor(
    public readonly dbPath: string,
    public readonly migration: StorageMigration,
  ) {
    const warnings = migration.warnings.length > 0 ? ` Warnings: ${migration.warnings.join(" | ")}` : ""
    super(`Refusing to apply destructive storage migration for ${dbPath}.${warnings}`)
    this.name = "StorageMigrationError"
  }
}

export function createStorageSession(app = APP_NAME): Session {
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

export function defaultStoragePath(app = APP_NAME) {
  return resolveDefaultStoragePath(app)
}

function defaultSecretName(app = APP_NAME): string {
  return `${APP_NAME}_${app}_encryption_key`
}

export async function getExistingLocalStorageEncryptionKey(
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

export async function getOrCreateLocalStorageEncryptionKey(secrets: SecretStore, app = APP_NAME): Promise<string> {
  let key = await getExistingLocalStorageEncryptionKey(secrets, app)
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

export async function validateStorageAccess(client: Client): Promise<void> {
  // Force a real schema read so encrypted files fail fast when the key is wrong.
  await client.execute("SELECT COUNT(*) FROM sqlite_master")
  await client.execute("PRAGMA foreign_keys = ON")
}

export async function bootLocalStorage(
  args: {
    allowDestructiveMigration?: boolean
    app?: string
    dbPath?: string
    encryptionKey?: string
    secrets?: SecretStore
    session?: Session
  } = {},
): Promise<BootLocalStorageResult> {
  const app = args.app ?? APP_NAME
  const dbPath = args.dbPath ?? defaultStoragePath(app)
  await mkdir(path.dirname(dbPath), { recursive: true })

  const encryptionKey =
    args.encryptionKey ?? (await getOrCreateLocalStorageEncryptionKey(args.secrets ?? defaultSecretStore(), app))
  const client = createClient({
    encryptionKey,
    url: pathToFileURL(dbPath).href,
  })

  try {
    await validateStorageAccess(client)

    const db = drizzle(client, { schema: storageSchema })
    const push = await pushSQLiteSchema(storageSchema, db)
    const migration: StorageMigration = {
      hasDataLoss: push.hasDataLoss,
      statementsToExecute: [...push.statementsToExecute],
      warnings: [...push.warnings],
    }

    if (migration.hasDataLoss && !args.allowDestructiveMigration) {
      throw new StorageMigrationError(dbPath, migration)
    }

    if (migration.statementsToExecute.length > 0) {
      await push.apply()
    }

    const session = args.session ?? createStorageSession(app)
    await db.insert(sessions).values({
      app: session.app,
      createdAt: session.createdAt,
      id: session.id,
    })

    return {
      client,
      close: () => {
        client.close()
      },
      db,
      dbPath,
      migration,
      session,
    }
  } catch (error) {
    client.close()
    throw error
  }
}
