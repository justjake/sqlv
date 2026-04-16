import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ident, unsafeRawSQL } from "#domain/SQL"

import { createNoopLogStore } from "#engine/runtime/createNoopLogStore"
import { QueryRunnerImpl } from "#engine/runtime/QueryRunnerImpl"

import { BunSqlAdapter } from "#adapters/sqlite/bun/BunSqliteAdapter"
import {
  IterateSqliteSchema,
  PragmaDatabaseList,
  SQLITE_SCHEMA_TABLE_NAME,
  jsonb_patch,
  parsePragmaDatabaseListRow,
  parseSqliteSchemaRow,
  sqlite,
  type SqliteSchemaRow,
} from "#adapters/sqlite/sqlite"

import {
  makeAppStateRow,
  makeConnection,
  makeSavedQuery,
  makeSettingsRow,
  createTempDir,
  removePath,
} from "../../../testSupport"

import { bootLocalStorage } from "./boot"
import { createSession } from "./createLocalStorage"
import { Storage } from "./Storage"

describe("sqlite-backed storage", () => {
  test("parses sqlite metadata rows", () => {
    const parent = {
      database: "main",
      schema: undefined,
    }
    const tableRow: SqliteSchemaRow = {
      type: "table",
      name: "users",
      tbl_name: "users",
      rootpage: 1,
      sql: "CREATE TABLE users (id INTEGER PRIMARY KEY)",
    }

    expect(SQLITE_SCHEMA_TABLE_NAME).toBe("sqlite_schema")
    expect(parsePragmaDatabaseListRow({ file: "/tmp/app.db", name: "main", seq: 0 })).toEqual({
      file: "/tmp/app.db",
      name: "main",
      type: "database",
    })
    expect(parseSqliteSchemaRow(parent, tableRow)).toEqual({
      database: "main",
      name: "users",
      schema: undefined,
      type: "table",
    })
    expect(
      parseSqliteSchemaRow(parent, {
        ...tableRow,
        type: "index",
        name: "users_name_idx",
      }),
    ).toEqual({
      name: "users_name_idx",
      on: {
        database: "main",
        name: "users",
        schema: undefined,
        type: "table",
      },
      type: "index",
    })
    expect(
      parseSqliteSchemaRow(parent, {
        ...tableRow,
        type: "view",
        name: "active_users",
      }),
    ).toEqual({
      database: "main",
      name: "active_users",
      schema: undefined,
      type: "view",
    })
    expect(
      parseSqliteSchemaRow(parent, {
        ...tableRow,
        type: "trigger",
        name: "users_trigger",
      }),
    ).toEqual({
      on: {
        database: "main",
        name: "users",
        schema: undefined,
        type: "table",
      },
      type: "trigger",
    })

    const query = sqlite`select * from ${ident("users")} where id = ${1}`
    expect(query.toSource()).toBe('select * from "users" where id = $1')
    expect(query.getArgs()).toEqual([1])
    expect(sqlite`select ${jsonb_patch(sqlite`payload`, '{"b":2}')} as value`.toSource()).toBe(
      "select jsonb(json_patch(json(payload), json($1))) as value",
    )
    expect(sqlite`select ${jsonb_patch(sqlite`payload`, '{"b":2}')} as value`.getArgs()).toEqual(['{"b":2}'])
    expect(PragmaDatabaseList.toSource().toLowerCase()).toContain("pragma database_list")
    expect(
      IterateSqliteSchema.query({
        cursor: {
          name: "",
          type: "",
        },
        limit: 25,
        schemaTable: ident("sqlite_schema", { schema: "main" }),
      }).toSource(),
    ).toContain('FROM "main"."sqlite_schema"')
  })

  test("provides a noop log store", async () => {
    const store = createNoopLogStore()
    const session = createSession("noop")

    expect(await store.get({ id: session.id, type: "session" })).toBeUndefined()
    expect(await store.insert(session)).toEqual(session)
    expect(await store.upsert(session)).toEqual(session)
    await expect(store.update({ id: session.id, type: "session" }, { app: "changed" })).resolves.toBeUndefined()
    await expect(store.delete({ id: session.id, type: "session" })).resolves.toBeUndefined()
  })

  test("stores domain rows through Drizzle repositories", async () => {
    const dir = await createTempDir()
    const storagePath = join(dir, "storage.db")
    const boot = await bootLocalStorage({
      dbPath: storagePath,
      encryptionKey: "d".repeat(64),
    })
    const storage = new Storage(boot.db)

    try {
      const connection = makeConnection({
        config: {
          path: join(dir, "query.db"),
        },
        protocol: "bunsqlite",
      })
      const savedQuery = makeSavedQuery({
        id: "saved-1",
      })
      const workspace = makeSettingsRow("workspace", {
        lastSelectedConnectionId: connection.id,
      })
      const preferences = makeAppStateRow("preferences", {
        iconStyle: "nerdfont",
      })

      await storage.connections.upsert(connection)
      await storage.savedQueries.upsert(savedQuery)
      await storage.settings.upsert(workspace)
      await storage.appState.upsert(preferences)

      expect(await storage.connections.get({ id: connection.id, type: "connection" })).toMatchObject(connection)
      expect(await storage.savedQueries.get({ id: savedQuery.id, type: "savedQuery" })).toMatchObject(savedQuery)
      expect(await storage.settings.get({ id: "workspace", type: "settings" })).toMatchObject(workspace)
      expect(await storage.appState.get({ id: "preferences", type: "appState" })).toMatchObject(preferences)
    } finally {
      boot.close()
      await removePath(dir)
    }
  })

  test("records flow and query execution logs through Drizzle storage", async () => {
    const dir = await createTempDir()
    const storagePath = join(dir, "storage.db")
    const boot = await bootLocalStorage({
      dbPath: storagePath,
      encryptionKey: "e".repeat(64),
    })
    const storage = new Storage(boot.db)
    const adapter = new BunSqlAdapter()
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const executor = await adapter.connect(connection.config)
    const db = new QueryRunnerImpl(boot.session, connection, executor, storage.log)

    try {
      const flow = await db.openFlow({
        initiator: "system",
        name: "load-objects",
      })
      await db.closeFlow(flow, {
        cancelled: false,
      })

      const execution = await db.execute<{ value: number }>(unsafeRawSQL("select 1 as value"))

      expect(await storage.log.get({ id: boot.session.id, type: "session" })).toMatchObject(boot.session)
      expect(await storage.log.get({ id: flow.id, type: "flow" })).toMatchObject({
        cancelled: false,
        connectionId: connection.id,
        id: flow.id,
        name: "load-objects",
        type: "flow",
      })
      expect(await storage.log.get({ id: execution.id, type: "queryExecution" })).toMatchObject({
        connectionId: connection.id,
        id: execution.id,
        rowCount: 1,
        rows: [{ value: 1 }],
        status: "success",
        type: "queryExecution",
      })
    } finally {
      boot.close()
      await removePath(dir)
    }
  })

  test("introspects sqlite objects through the Bun adapter", async () => {
    const adapter = new BunSqlAdapter()
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const executor = await adapter.connect(connection.config)
    const db = new QueryRunnerImpl(createSession("adapter"), connection, executor, createNoopLogStore())

    await db.query(unsafeRawSQL("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)"))
    await db.query(
      unsafeRawSQL("CREATE TABLE memberships (user_id TEXT, role_id TEXT, PRIMARY KEY (user_id, role_id))"),
    )
    await db.query(unsafeRawSQL("CREATE VIEW widget_names AS SELECT name FROM widgets"))

    const objects = await adapter.fetchObjects(db)

    expect(objects).toContainEqual({
      file: "",
      name: "main",
      type: "database",
    })
    expect(objects).toContainEqual({
      database: "main",
      name: "widgets",
      schema: undefined,
      type: "table",
    })
    expect(objects).toContainEqual({
      database: "main",
      name: "widget_names",
      schema: undefined,
      type: "view",
    })
    expect(objects).toContainEqual({
      automatic: true,
      name: "sqlite_autoindex_memberships_1",
      on: {
        database: "main",
        name: "memberships",
        schema: undefined,
        type: "table",
      },
      type: "index",
    })
  })
})
