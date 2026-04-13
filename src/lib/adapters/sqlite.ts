import type { DatabaseInfo, ObjectInfo, TableInfo } from "../types/objects"
import { Identifier, Paginated, SQL, sql, type SQLValue } from "../types/SQL"
import { unreachable } from "../types/unreachable"

export type SqliteArg = string | number | null

export type SqliteObjectType = "table" | "index" | "view" | "trigger"

export const SQLITE_SCHEMA_TABLE_NAME = "sqlite_schema"

export type SqliteSchemaRow = {
  /**
   * The sqlite_schema.type column will be one of the following text strings:
   * 'table', 'index', 'view', or 'trigger' according to the type of object
   * defined. The 'table' string is used for both ordinary and virtual tables.
   */
  type: SqliteObjectType
  /**
   * The sqlite_schema.name column will hold the name of the object. UNIQUE and
   * PRIMARY KEY constraints on tables cause SQLite to create internal indexes
   * with names of the form "sqlite_autoindex_TABLE_N" where TABLE is replaced
   * by the name of the table that contains the constraint and N is an integer
   * beginning with 1 and increasing by one with each constraint seen in the
   * table definition. In a WITHOUT ROWID table, there is no sqlite_schema entry
   * for the PRIMARY KEY, but the "sqlite_autoindex_TABLE_N" name is set aside
   * for the PRIMARY KEY as if the sqlite_schema entry did exist. This will
   * affect the numbering of subsequent UNIQUE constraints. The
   * "sqlite_autoindex_TABLE_N" name is never allocated for an INTEGER PRIMARY
   * KEY, either in rowid tables or WITHOUT ROWID tables.
   */
  name: string
  /**
   * The sqlite_schema.tbl_name column holds the name of a table or view that
   * the object is associated with. For a table or view, the tbl_name column is
   * a copy of the name column. For an index, the tbl_name is the name of the
   * table that is indexed. For a trigger, the tbl_name column stores the name
   * of the table or view that causes the trigger to fire.
   */
  tbl_name: string
  /**
   * The sqlite_schema.rootpage column stores the page number of the root b-tree
   * page for tables and indexes. For rows that define views, triggers, and
   * virtual tables, the rootpage column is 0 or NULL.
   */
  rootpage: number | null
  /**
   * The sqlite_schema.sql column stores SQL text that describes the object.
   * This SQL text is a CREATE TABLE, CREATE VIRTUAL TABLE, CREATE INDEX, CREATE
   * VIEW, or CREATE TRIGGER statement that if evaluated against the database
   * file when it is the main database of a database connection would recreate
   * the object. The text is usually a copy of the original statement used to
   * create the object but with normalizations applied so that the text conforms
   * to the following rules:
   *
   * - The CREATE, TABLE, VIEW, TRIGGER, and INDEX keywords at the beginning of the
   *   statement are converted to all upper case letters.
   * - The TEMP or TEMPORARY keyword is removed if it occurs after the initial CREATE keyword.
   * - Any database name qualifier that occurs prior to the name of the object being created is removed.
   * - Leading spaces are removed.
   * - All spaces following the first two keywords are converted into a single space.
   *
   * The text in the sqlite_schema.sql column is a copy of the original CREATE
   * statement text that created the object, except normalized as described above
   * and as modified by subsequent ALTER TABLE statements. The sqlite_schema.sql
   * is NULL for the internal indexes that are automatically created by UNIQUE or
   * PRIMARY KEY constraints.
   */
  sql: string | null
}

type SqliteNamespace = {
  database: string | undefined
  schema: string | undefined
}

function makeTable(name: string, ctx: SqliteNamespace): TableInfo {
  return {
    type: "table",
    ...ctx,
    name,
  }
}

export const IterateSqliteSchema = new Paginated<
  { schemaTable?: Identifier; limit: number; cursor: { type: SqliteObjectType | ""; name: string } },
  SqliteSchemaRow
>(
  (params) => sql<SqliteSchemaRow, SqliteArg>`
    SELECT * FROM ${params.schemaTable ?? sql`sqlite_schema`}
    WHERE (type, name) > (${params.cursor.type}, ${params.cursor.name})
    LIMIT ${params.limit}
  `,
  (row) => row,
)

export function parseSqliteSchemaRow(
  parent: { database: string | undefined; schema: string | undefined },
  row: SqliteSchemaRow,
): ObjectInfo {
  switch (row.type) {
    case "table":
      return makeTable(row.name, parent)
    case "index":
      return {
        type: "index",
        on: makeTable(row.tbl_name, parent),
      }
    case "view":
      return {
        type: "view",
        name: row.name,
        ...parent,
      }
    case "trigger":
      return {
        type: "trigger",
        // assume table
        // TODO: be exact
        on: makeTable(row.tbl_name, parent),
      }
    default:
      unreachable(row.type, () => new Error(`Unknown sqlite_schema row type: ${row.type}`))
  }
}

export type PragmaDatabaseListRow = {
  seq: number
  name: string
  file: string
}

export const PragmaDatabaseList = sql<PragmaDatabaseListRow, SqliteArg>`pragma database_list`

export function parsePragmaDatabaseListRow(row: PragmaDatabaseListRow): DatabaseInfo {
  return {
    type: "database",
    name: row.name,
    file: row.file,
  }
}

export type SqliteSQL<Row> = SQL<Row>
export function sqlite<Row>(strings: TemplateStringsArray, ...values: SQLValue<SqliteArg>[]): SqliteSQL<Row> {
  return sql<Row, SqliteArg>(strings, ...values)
}
