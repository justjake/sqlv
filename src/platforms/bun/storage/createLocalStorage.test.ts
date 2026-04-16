import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { makeConnection, makeSettingsRow, createTempDir, removePath } from "../../../testSupport"

import {
  createLocalStorage,
  createLocalStorageConnection,
  createSession,
  defaultStorageLocation,
  defaultSecretStore,
  getOrCreateLocalStorageEncryptionKey,
  type SecretRef,
} from "./createLocalStorage"

describe("local storage helpers", () => {
  test("creates sessions and derives a storage path", async () => {
    const session = createSession("cli")
    expect(session.app).toBe("cli")
    expect(session.type).toBe("session")
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/i)

    const originalXdgDataHome = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = "/tmp/sqlv-data"
    try {
      expect(defaultStorageLocation()).toBe("/tmp/sqlv-data/sqlv/sqlv.db")
    } finally {
      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
    }

    expect(defaultSecretStore()).toBe((Bun as any).secrets)

    const values = new Map<string, string>()
    const touched: SecretRef[] = []
    const secrets = {
      async delete(args: SecretRef) {
        return values.delete(`${args.service}:${args.name}`)
      },
      async get(args: SecretRef) {
        return values.get(`${args.service}:${args.name}`) ?? null
      },
      async set(args: SecretRef & { value: string }) {
        touched.push(args)
        values.set(`${args.service}:${args.name}`, args.value)
      },
    }

    const key = await getOrCreateLocalStorageEncryptionKey(secrets)
    const secondKey = await getOrCreateLocalStorageEncryptionKey(secrets)

    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(secondKey).toBe(key)
    expect(touched).toHaveLength(1)
  })

  test("creates a default local storage connection", async () => {
    const originalXdgDataHome = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = "/tmp/sqlv-persist"
    try {
      const connection = await createLocalStorageConnection({
        secrets: {
          async delete() {
            return false
          },
          async get() {
            return "a".repeat(64)
          },
          async set() {},
        },
      })

      expect(connection).toMatchObject({
        id: "__persist__",
        name: "sqlv",
        protocol: "turso",
        type: "connection",
      })
      expect(connection.config).toEqual({
        encryption: {
          cipher: "aegis256",
          hexkey: "a".repeat(64),
        },
        path: "/tmp/sqlv-persist/sqlv/sqlv.db",
      })
    } finally {
      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
    }
  })

  test("creates Drizzle-backed storage at a supplied path", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "persist.db")
    const local = await createLocalStorage({
      dbPath,
      encryptionKey: "b".repeat(64),
    })

    try {
      const connection = makeConnection({
        config: {
          path: join(dir, "query.db"),
        },
        protocol: "bunsqlite",
      })

      await local.storage.connections.upsert(connection)
      await local.storage.settings.upsert(makeSettingsRow("workspace", { lastSelectedConnectionId: connection.id }))

      expect(local.session.type).toBe("session")
      expect(await local.storage.connections.get({ id: connection.id, type: "connection" })).toMatchObject(connection)
      expect(await local.storage.settings.get({ id: "workspace", type: "settings" })).toMatchObject({
        id: "workspace",
        settings: {
          lastSelectedConnectionId: connection.id,
        },
        type: "settings",
      })
    } finally {
      local.close?.()
      await removePath(dir)
    }
  })

  test("creates default local storage through the Drizzle boot path", async () => {
    const dir = await createTempDir()
    const originalXdgDataHome = process.env.XDG_DATA_HOME
    let local: Awaited<ReturnType<typeof createLocalStorage>> | undefined
    try {
      process.env.XDG_DATA_HOME = dir

      local = await createLocalStorage({
        secrets: {
          async delete() {
            return false
          },
          async get() {
            return "c".repeat(64)
          },
          async set() {},
        },
      })

      expect(await local.storage.log.get({ id: local.session.id, type: "session" })).toMatchObject(local.session)
      expect(defaultStorageLocation()).toBe(join(dir, "sqlv", "sqlv.db"))
    } finally {
      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
      local?.close?.()
      await removePath(dir)
    }
  })
})
