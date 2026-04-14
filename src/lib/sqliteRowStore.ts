import { jsonb_patch, sqlite as sql } from "./adapters/sqlite"
import { EpochMillis } from "./types/Log"
import type { QueryRunner } from "./types/QueryRunner"
import {
  rowDispatcher,
  type BaseRow,
  type RowAction,
  type RowDelete,
  type RowGet,
  type RowInsert,
  type RowQuery,
  type RowUpdate,
  type RowUpsert,
} from "./types/RowStore"
import { Identifier, type SQL } from "./types/SQL"
import { unreachable } from "./types/unreachable"

export function createRowStoreTableSql(table: Identifier) {
  return sql`CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER,
    sort TEXT,
    json BLOB,
    version INTEGER NOT NULL,
    PRIMARY KEY (id, type)
  ) strict`
}

export function selectStoredRows<Row extends BaseRow>(table: Identifier): SQL<Row> {
  return sql`
    SELECT id, type, createdAt, updatedAt, sort, json(json) as json
    FROM ${table}
  `
}

const ActionToSql = {
  query: <Row extends BaseRow>(table: Identifier, action: RowQuery<Row>): SQL<Row> => action.q(table),
  get: <Row extends BaseRow>(table: Identifier, action: RowGet<Row>): SQL<Row> => {
    return sql`
      SELECT id, type, createdAt, updatedAt, sort, json(json) as json
      FROM ${table}
      WHERE id = ${action.ref.id} AND type = ${action.ref.type}
    `
  },
  insert: <Row extends BaseRow>(table: Identifier, action: RowInsert<Row>): SQL<Row> => {
    const { id, type, createdAt, updatedAt, sort, ...json } = action.row
    return sql`
      INSERT INTO ${table} (id, type, createdAt, updatedAt, sort, json, version)
      VALUES (${id}, ${type}, ${createdAt}, ${updatedAt ?? null}, ${sort ?? null}, jsonb(${JSON.stringify(json)}), 1)
      RETURNING id, type, createdAt, updatedAt, sort, json(json) as json
    `
  },
  upsert: <Row extends BaseRow>(table: Identifier, action: RowUpsert<Row>): SQL<Row> => {
    const { id, type, createdAt, updatedAt, sort, ...json } = action.row
    return sql`
      INSERT INTO ${table} (id, type, createdAt, updatedAt, sort, json, version)
      VALUES (${id}, ${type}, ${createdAt}, ${updatedAt ?? null}, ${sort ?? null}, jsonb(${JSON.stringify(json)}), 1)
      ON CONFLICT DO UPDATE SET
        updatedAt = EXCLUDED.updatedAt,
        sort = COALESCE(EXCLUDED.sort, sort),
        json = ${jsonb_patch(sql`json`, sql`EXCLUDED.json`)},
        version = version + 1
      RETURNING id, type, createdAt, updatedAt, sort, json(json) as json
    `
  },
  update: <Row extends BaseRow>(table: Identifier, action: RowUpdate<Row>): SQL<Row> => {
    const { id, type } = action.ref
    const { updatedAt, sort, ...json } = action.patch
    return sql`
      UPDATE ${table} SET
        updatedAt = ${updatedAt ?? EpochMillis.now()},
        sort = COALESCE(${sort ?? null}, sort),
        json = ${jsonb_patch(sql`json`, JSON.stringify(json))},
        version = version + 1
      WHERE id = ${id} AND type = ${type}
      RETURNING id, type, createdAt, updatedAt, sort, json(json) as json
    `
  },
  delete: <Row extends BaseRow>(table: Identifier, action: RowDelete<Row>): SQL<Row> => sql`
    DELETE FROM ${table} WHERE id = ${action.ref.id} AND type = ${action.ref.type}
    RETURNING id, type, createdAt, updatedAt, sort, json(json) as json
  `,
}

function actionToSql<Row extends BaseRow>(table: Identifier, action: RowAction<Row>): SQL<Row> {
  switch (action.type) {
    case "query":
      return ActionToSql.query(table, action)
    case "get":
      return ActionToSql.get(table, action)
    case "insert":
      return ActionToSql.insert(table, action)
    case "upsert":
      return ActionToSql.upsert(table, action)
    case "update":
      return ActionToSql.update(table, action)
    case "delete":
      return ActionToSql.delete(table, action)
    default:
      unreachable(action)
  }
}

export function createSqliteRowStore<Row extends BaseRow>(db: QueryRunner, table: Identifier) {
  return rowDispatcher<Row>(async <T extends Row>(action: RowAction<T>): Promise<T | T[] | undefined> => {
    const sql = actionToSql(table, action)
    const unparsed: BaseRow[] = await db.query(sql)
    const rows: T[] = unparsed.map((r) => parseRow(r))
    return rows
  })
}

function parseRow<Row extends BaseRow>(row: BaseRow): Row {
  const { json, ...rest } = row
  if (typeof json === "string") {
    return {
      ...JSON.parse(json),
      ...rest,
    }
  } else if (isJsonObject(json)) {
    return {
      ...json,
      ...rest,
    } as Row
  } else {
    return row as Row
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
