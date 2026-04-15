import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { BunSqlAdapter } from "../../src/lib/adapters/BunSqlAdapter"
import { TursoAdapter } from "../../src/lib/adapters/TursoAdapter"
import { createSession } from "../../src/lib/createLocalPersistence"
import { createNoopLogStore } from "../../src/lib/createNoopLogStore"
import { AdapterRegistry } from "../../src/lib/interface/Adapter"
import { type ExecuteRequest, ExecuteError } from "../../src/lib/interface/Executor"
import { QueryRunnerImpl } from "../../src/lib/QueryRunnerImpl"
import { sql, unsafeRawSQL } from "../../src/lib/types/SQL"
import { createTempDir, makeConnection, removePath } from "../support"

describe("database adapters", () => {
  test("registers adapters and wraps execute errors", () => {
    const adapter = new BunSqlAdapter()
    const registry = new AdapterRegistry()

    registry.register(adapter)

    expect(registry.has("bunsqlite")).toBe(true)
    expect(registry.get("bunsqlite")).toBe(adapter)
    expect(registry.list()).toEqual([adapter])
    expect(() => registry.register(adapter)).toThrow("Adapter already registered for protocol bunsqlite")
    expect(() => registry.get("turso")).toThrow("No adapter registered for protocol turso")

    const cause = new Error("bad sql")
    cause.stack = "Error: bad sql\n    at original (adapter.test.ts:1:1)"
    const req: ExecuteRequest<{ value: number }> = {
      abortSignal: undefined,
      sql: unsafeRawSQL("select 1"),
    }
    const error = new ExecuteError({
      cause,
      connectionId: "conn-1",
      message: "boom",
      req,
    })

    expect(error.message).toBe("boom")
    expect(error.connectionId).toBe("conn-1")
    expect(error.req).toBe(req)
    expect(error.cause).toBeInstanceOf(Error)
    expect(error.stack).toBe(cause.stack)
  })

  test("executes queries with the Bun sqlite adapter", async () => {
    const adapter = new BunSqlAdapter()

    expect(adapter.treeSitterGrammar).toBe("sql")
    expect(
      adapter.describeConfig({
        create: false,
        path: "app.db",
        readonly: true,
        readwrite: false,
        safeIntegers: true,
        strict: true,
      }),
    ).toBe("app.db (readonly create=false readwrite=false safeIntegers strict)")
    expect(adapter.renderSQL(sql`select ${1} as value`)).toEqual({
      args: [1],
      source: "select $1 as value",
    })

    const dir = await createTempDir()
    try {
      const connection = makeConnection({
        config: {
          path: join(dir, "nested", "bun.db"),
        },
        protocol: "bunsqlite",
      })
      const executor = await adapter.connect(connection.config)
      const db = new QueryRunnerImpl(createSession("bun"), connection, executor, createNoopLogStore())

      await db.query(unsafeRawSQL("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)"))
      await db.query(unsafeRawSQL("INSERT INTO notes (body) VALUES ('hello')"))

      expect(await db.query(sql<{ body: string }>`SELECT body FROM notes`)).toEqual([
        {
          body: "hello",
        },
      ])
    } finally {
      await removePath(dir)
    }
  })

  test("executes queries with the Turso adapter against local files", async () => {
    const adapter = new TursoAdapter()

    expect(adapter.treeSitterGrammar).toBe("sql")
    expect(
      adapter.describeConfig({
        encryption: {
          cipher: "aegis256",
          hexkey: "deadbeef",
        },
        path: "app.db",
        readonly: true,
      }),
    ).toBe("app.db (readonly encrypted(aegis256))")
    expect(adapter.renderSQL(sql`select ${2} as value`)).toEqual({
      args: [2],
      source: "select $1 as value",
    })

    const dir = await createTempDir()
    try {
      const connection = makeConnection({
        config: {
          path: join(dir, "nested", "turso.db"),
        },
        protocol: "turso",
      })
      const executor = await adapter.connect(connection.config)
      const db = new QueryRunnerImpl(createSession("turso"), connection, executor, createNoopLogStore())

      await db.query(unsafeRawSQL("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)"))
      await db.query(unsafeRawSQL("INSERT INTO posts (title) VALUES ('hello')"))

      expect(await db.query(sql<{ title: string }>`SELECT title FROM posts`)).toEqual([
        {
          title: "hello",
        },
      ])

      const objects = await adapter.fetchObjects(db)
      expect(objects).toContainEqual({
        database: "main",
        name: "posts",
        schema: undefined,
        type: "table",
      })
    } finally {
      await removePath(dir)
    }
  })
})
