import { describe, expect, test } from "bun:test"
import { BunSqlAdapter } from "../../src/lib/adapters/BunSqlAdapter"
import {
  IterateSqliteSchema,
  PragmaDatabaseList,
  SQLITE_SCHEMA_TABLE_NAME,
  jsonb_patch,
  parsePragmaDatabaseListRow,
  parseSqliteSchemaRow,
  sqlite,
  type SqliteSchemaRow,
} from "../../src/lib/adapters/sqlite"
import { createSession } from "../../src/lib/createLocalPersistence"
import { createNoopLogStore } from "../../src/lib/createNoopLogStore"
import { Persist } from "../../src/lib/Persist"
import { QueryRunnerImpl } from "../../src/lib/QueryRunnerImpl"
import { createRowStoreTableSql, createSqliteRowStore, selectStoredRows } from "../../src/lib/sqliteRowStore"
import type { Connection } from "../../src/lib/types/Connection"
import { EpochMillis, type LogEntry } from "../../src/lib/types/Log"
import { OrderString } from "../../src/lib/types/Order"
import type { BaseRow } from "../../src/lib/types/RowStore"
import { ident, unsafeRawSQL } from "../../src/lib/types/SQL"
import { createBunQueryRunner, makeConnection } from "../support"

type StoredRow = BaseRow & {
  extra?: {
    enabled: boolean
  }
  name: string
  value?: number
}

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

    expect(await store.query(() => unsafeRawSQL<LogEntry>("select"))).toEqual([])
    expect(await store.get({ id: session.id, type: "session" })).toBeUndefined()
    expect(await store.insert(session)).toEqual(session)
    expect(await store.upsert(session)).toEqual(session)
    await expect(store.update({ id: session.id, type: "session" }, { app: "changed" })).resolves.toBeUndefined()
    await expect(store.delete({ id: session.id, type: "session" })).resolves.toBeUndefined()
  })

  test("stores structured rows in sqlite tables", async () => {
    const { db } = await createBunQueryRunner()
    const table = ident("items")

    await db.query(createRowStoreTableSql(table))
    const store = createSqliteRowStore<StoredRow>(db, table)

    const row: StoredRow = {
      createdAt: EpochMillis(1),
      id: "row-1",
      name: "first",
      sort: OrderString(""),
      type: "item",
    }

    expect(await store.insert(row)).toMatchObject(row)
    expect(await store.get({ id: row.id, type: row.type })).toMatchObject(row)

    await store.upsert({
      ...row,
      extra: {
        enabled: true,
      },
      value: 2,
    })
    await store.update(
      {
        id: row.id,
        type: row.type,
      },
      {
        name: "updated",
      },
    )

    expect(
      await store.query(
        (currentTable) => sqlite<StoredRow>`${selectStoredRows<StoredRow>(currentTable)} ORDER BY id ASC`,
      ),
    ).toEqual([
      expect.objectContaining({
        extra: {
          enabled: true,
        },
        id: "row-1",
        name: "updated",
        value: 2,
      }),
    ])

    await store.delete({ id: row.id, type: row.type })
    expect(await store.get({ id: row.id, type: row.type })).toBeUndefined()
  })

  test("migrates persistence tables and exposes row stores", async () => {
    const { db } = await createBunQueryRunner()
    const persist = new Persist(db)

    await persist.migrate()

    const connection: Connection<{ path: string }> = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const session = createSession("persist")

    await persist.connections.upsert(connection)
    await persist.log.upsert(session)

    expect(await persist.connections.get({ id: connection.id, type: "connection" })).toMatchObject(connection)
    expect(await persist.log.get({ id: session.id, type: "session" })).toMatchObject(session)
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
  })
})
