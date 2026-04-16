import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createClient, type Client } from "@libsql/client/node"
import { pushSQLiteSchema } from "drizzle-kit/api"
import { sql } from "drizzle-orm"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { createTempDir, removePath } from "../support"

function createUserSchemaV1() {
  const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
  })

  return { users }
}

function createUserSchemaV2() {
  const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
  })

  return { users }
}

function createUserSchemaWithRequiredAge() {
  const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    age: integer("age").notNull(),
  })

  return { users }
}

function openLibsqlDb<TSchema extends Record<string, unknown>>(dbPath: string, schema?: TSchema) {
  const client = createClient({
    url: pathToFileURL(dbPath).href,
  })

  return {
    client,
    db: schema ? drizzle(client, { schema }) : drizzle(client),
  }
}

async function getColumnNames(db: LibSQLDatabase<any>, tableName: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(\`${tableName}\`)`))
  return rows.map((row) => row.name)
}

function statementsContain(statements: string[], ...snippets: string[]): boolean {
  return statements.some((statement) => {
    const normalized = statement.toLowerCase()
    return snippets.every((snippet) => normalized.includes(snippet.toLowerCase()))
  })
}

describe("drizzle runtime migration POC", () => {
  test("pushes schema into an empty sqlite database without generated migration files", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "empty.db")
    const schema = createUserSchemaV1()
    const { client, db } = openLibsqlDb(dbPath, schema)

    try {
      expect(await getColumnNames(db, "users")).toEqual([])

      const push = await pushSQLiteSchema(schema, db)

      expect(push.hasDataLoss).toBe(false)
      expect(push.warnings).toEqual([])
      expect(push.statementsToExecute.length).toBeGreaterThan(0)
      expect(statementsContain(push.statementsToExecute, "create table", "users")).toBe(true)

      await push.apply()

      expect(await getColumnNames(db, "users")).toEqual(["id", "name"])
    } finally {
      client.close()
      await removePath(dir)
    }
  })

  test("applies additive runtime schema changes while preserving existing rows", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "additive.db")
    const schemaV1 = createUserSchemaV1()
    const initial = openLibsqlDb(dbPath, schemaV1)
    let initialClient: Client | undefined = initial.client
    let reopenedClient: Client | undefined

    try {
      await (await pushSQLiteSchema(schemaV1, initial.db)).apply()
      await initial.db.insert(schemaV1.users).values({
        id: "user-1",
        name: "Ada",
      })
      initialClient.close()
      initialClient = undefined

      const schemaV2 = createUserSchemaV2()
      const reopened = openLibsqlDb(dbPath, schemaV2)
      reopenedClient = reopened.client

      const push = await pushSQLiteSchema(schemaV2, reopened.db)

      expect(push.hasDataLoss).toBe(false)
      expect(push.warnings).toEqual([])
      expect(await getColumnNames(reopened.db, "users")).toEqual(["id", "name"])

      await push.apply()

      expect(await getColumnNames(reopened.db, "users")).toEqual(["id", "name", "email"])

      const rows = await reopened.db.select().from(schemaV2.users)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: "user-1",
        name: "Ada",
      })
      expect(rows[0]?.email ?? null).toBeNull()
    } finally {
      reopenedClient?.close()
      initialClient?.close()
      await removePath(dir)
    }
  })

  test("surfaces destructive runtime changes before applying them", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "destructive.db")
    const schemaV1 = createUserSchemaV1()
    const initial = openLibsqlDb(dbPath, schemaV1)
    let initialClient: Client | undefined = initial.client
    let reopenedClient: Client | undefined

    try {
      await (await pushSQLiteSchema(schemaV1, initial.db)).apply()
      await initial.db.insert(schemaV1.users).values({
        id: "user-1",
        name: "Ada",
      })
      initialClient.close()
      initialClient = undefined

      const schemaV2 = createUserSchemaWithRequiredAge()
      const reopened = openLibsqlDb(dbPath, schemaV2)
      reopenedClient = reopened.client

      const push = await pushSQLiteSchema(schemaV2, reopened.db)

      expect(push.hasDataLoss).toBe(true)
      expect(push.warnings.length).toBeGreaterThan(0)
      expect(push.warnings.join("\n").toLowerCase()).toContain("not-null")
      expect(await getColumnNames(reopened.db, "users")).toEqual(["id", "name"])
      expect(statementsContain(push.statementsToExecute, "delete from", "users")).toBe(true)
      expect(statementsContain(push.statementsToExecute, "alter table", "users", "age")).toBe(true)
    } finally {
      reopenedClient?.close()
      initialClient?.close()
      await removePath(dir)
    }
  })

  test("file-based libsql migrate still requires generated migration files", async () => {
    const dir = await createTempDir()
    const dbPath = join(dir, "migrate.db")
    const migrationsFolder = join(dir, "drizzle")
    const { client, db } = openLibsqlDb(dbPath)

    try {
      await mkdir(migrationsFolder, { recursive: true })

      await expect(
        migrate(db, {
          migrationsFolder,
        }),
      ).rejects.toThrow("Can't find meta/_journal.json file")
    } finally {
      client.close()
      await removePath(dir)
    }
  })
})
