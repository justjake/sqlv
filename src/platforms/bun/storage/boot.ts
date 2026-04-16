import * as path from "node:path"
import { mkdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { createClient, type Client } from "@libsql/client/node"
import { pushSQLiteSchema } from "drizzle-kit/api"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import { createId } from "../../../model/Id"
import { EpochMillis, type Session } from "../../../model/Log"
import { DEFAULT_SQLVISOR_APP, defaultStoragePath as resolveDefaultStoragePath } from "../paths"
import { auditEvents } from "./schema/auditEvents"
import { connections } from "./schema/connections"
import { queryExecutions } from "./schema/queryExecutions"
import { savedQueries } from "./schema/savedQueries"
import { sessions } from "./schema/sessions"
import { settings } from "./schema/settings"

const APP_NAME = DEFAULT_SQLVISOR_APP
const BUNDLE_ID = `tl.jake.${APP_NAME}`
const ENCRYPTION_SECRET_DEFAULT_NAME = `${APP_NAME}_storage_encryption_key`

export type SecretRef = { service: string; name: string }

/** https://bun.com/docs/runtime/secrets#api */
export type SecretStore = {
  get: (args: SecretRef) => Promise<string | null>
  set: (args: SecretRef & { value: string }) => Promise<void>
  delete: (args: SecretRef) => Promise<boolean>
}

export const storageSchema = {
  auditEvents,
  connections,
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

export function defaultStoragePath() {
  return resolveDefaultStoragePath(APP_NAME)
}

export async function getExistingLocalStorageEncryptionKey(
  secrets = defaultSecretStore(),
): Promise<string | undefined> {
  try {
    return (
      (await secrets.get({
        service: BUNDLE_ID,
        name: ENCRYPTION_SECRET_DEFAULT_NAME,
      })) ?? undefined
    )
  } catch {
    return undefined
  }
}

export async function getOrCreateLocalStorageEncryptionKey(secrets: SecretStore): Promise<string> {
  let key = await getExistingLocalStorageEncryptionKey(secrets)
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
  const dbPath = args.dbPath ?? defaultStoragePath()
  await mkdir(path.dirname(dbPath), { recursive: true })

  const encryptionKey =
    args.encryptionKey ?? (await getOrCreateLocalStorageEncryptionKey(args.secrets ?? defaultSecretStore()))
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

    const session = args.session ?? createStorageSession(args.app ?? APP_NAME)
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
