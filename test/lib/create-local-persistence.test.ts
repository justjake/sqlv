import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { BunSqlAdapter } from "../../src/lib/adapters/BunSqlAdapter"
import { TursoAdapter } from "../../src/lib/adapters/TursoAdapter"
import {
  createLocalPersistence,
  createLocalPersistenceConnection,
  createSession,
  defaultPersistLocation,
  defaultSecretStore,
  getOrCreateLocalEncryptionKey,
  type SecretRef,
} from "../../src/lib/createLocalPersistence"
import { AdapterRegistry } from "../../src/lib/interface/Adapter"
import { createTempDir, makeConnection, removePath } from "../support"

describe("local persistence helpers", () => {
  test("creates sessions and derives a persist path", async () => {
    const session = createSession("cli")
    expect(session.app).toBe("cli")
    expect(session.type).toBe("session")
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/i)

    const originalXdgDataHome = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = "/tmp/sqlv-data"
    try {
      expect(defaultPersistLocation()).toBe("/tmp/sqlv-data/sqlv/sqlv.db")
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

    const key = await getOrCreateLocalEncryptionKey(secrets)
    const secondKey = await getOrCreateLocalEncryptionKey(secrets)

    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(secondKey).toBe(key)
    expect(touched).toHaveLength(1)
  })

  test("creates a default local persistence connection", async () => {
    const originalXdgDataHome = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = "/tmp/sqlv-persist"
    try {
      const connection = await createLocalPersistenceConnection({
        async delete() {
          return false
        },
        async get() {
          return "a".repeat(64)
        },
        async set() {},
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

  test("creates persistence against a supplied registry and connection", async () => {
    const dir = await createTempDir()
    try {
      const registry = new AdapterRegistry([new BunSqlAdapter()])
      const connection = makeConnection({
        config: {
          path: join(dir, "persist.db"),
        },
        protocol: "bunsqlite",
      })

      const local = await createLocalPersistence({
        connection,
        registry,
      })

      await local.persist.connections.upsert(connection)

      expect(local.session.type).toBe("session")
      expect(await local.persist.connections.get({ id: connection.id, type: "connection" })).toMatchObject(connection)
    } finally {
      await removePath(dir)
    }
  })

  test("creates default local persistence with turso row storage", async () => {
    const dir = await createTempDir()
    const originalXdgDataHome = process.env.XDG_DATA_HOME
    try {
      process.env.XDG_DATA_HOME = dir
      const registry = new AdapterRegistry([new TursoAdapter()])

      const local = await createLocalPersistence({
        registry,
        secrets: {
          async delete() {
            return false
          },
          async get() {
            return "b".repeat(64)
          },
          async set() {},
        },
      })

      await local.persist.log.upsert(local.session)

      expect(await local.persist.log.get({ id: local.session.id, type: "session" })).toMatchObject(local.session)
      expect(defaultPersistLocation()).toBe(join(dir, "sqlv", "sqlv.db"))
    } finally {
      if (originalXdgDataHome === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = originalXdgDataHome
      }
      await removePath(dir)
    }
  })
})
