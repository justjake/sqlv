import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import {
  bootLocalStorage,
  defaultStoragePath,
  getOrCreateLocalStorageEncryptionKey,
} from "../../src/lib/storage/boot"
import { sessions } from "../../src/lib/storage/schema/sessions"
import { createTempDir, removePath } from "../support"

async function listTableNames(db: Awaited<ReturnType<typeof bootLocalStorage>>["db"]): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    sql.raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"),
  )
  return rows.map((row) => row.name)
}

describe("storage boot", () => {
  test("boots an encrypted local storage database and creates the schema", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "storage.db")
    const storage = await bootLocalStorage({
      dbPath,
      encryptionKey: "d".repeat(64),
    })

    try {
      expect(storage.dbPath).toBe(dbPath)
      expect(storage.session.type).toBe("session")
      expect(storage.migration.hasDataLoss).toBe(false)
      expect(storage.migration.statementsToExecute.length).toBeGreaterThan(0)
      expect(await listTableNames(storage.db)).toEqual([
        "audit_events",
        "connections",
        "query_executions",
        "saved_queries",
        "sessions",
        "settings",
      ])

      const persistedSessions = await storage.db.select().from(sessions)
      expect(persistedSessions).toHaveLength(1)
      expect(persistedSessions[0]).toMatchObject({
        app: "sqlv",
        id: storage.session.id,
      })
    } finally {
      storage.close()
      await removePath(dir)
    }
  })

  test("reopening the same database is idempotent and records a new session", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "storage.db")
    const encryptionKey = "e".repeat(64)
    const first = await bootLocalStorage({
      dbPath,
      encryptionKey,
    })

    try {
      expect(first.migration.statementsToExecute.length).toBeGreaterThan(0)
    } finally {
      first.close()
    }

    const second = await bootLocalStorage({
      dbPath,
      encryptionKey,
    })

    try {
      expect(second.migration.hasDataLoss).toBe(false)
      expect(second.migration.statementsToExecute).toEqual([])

      const persistedSessions = await second.db.select().from(sessions)
      expect(persistedSessions).toHaveLength(2)
    } finally {
      second.close()
      await removePath(dir)
    }
  })

  test("fails boot when opening an encrypted database with the wrong key", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "storage.db")
    const first = await bootLocalStorage({
      dbPath,
      encryptionKey: "f".repeat(64),
    })

    try {
      first.close()

      await expect(
        bootLocalStorage({
          dbPath,
          encryptionKey: "0".repeat(64),
        }),
      ).rejects.toThrow()
    } finally {
      await removePath(dir)
    }
  })

  test("derives a default path and storage encryption key from secrets", async () => {
    const originalXdgDataHome = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = "/tmp/sqlv-storage"

    try {
      expect(defaultStoragePath()).toBe("/tmp/sqlv-storage/sqlv/sqlv-storage.db")

      const values = new Map<string, string>()
      const secrets = {
        async delete(args: { service: string; name: string }) {
          return values.delete(`${args.service}:${args.name}`)
        },
        async get(args: { service: string; name: string }) {
          return values.get(`${args.service}:${args.name}`) ?? null
        },
        async set(args: { service: string; name: string; value: string }) {
          values.set(`${args.service}:${args.name}`, args.value)
        },
      }

      const first = await getOrCreateLocalStorageEncryptionKey(secrets)
      const second = await getOrCreateLocalStorageEncryptionKey(secrets)

      expect(first).toMatch(/^[0-9a-f]{64}$/)
      expect(second).toBe(first)
    } finally {
      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
    }
  })
})
