import type { ExplainInput, ExplainResult } from "#domain/Explain"
import type { DatabaseInfo, ObjectInfo, TableInfo } from "#domain/objects"
import { Identifier, Paginated, SQL, sql, unsafeRawSQL, type SQLValue } from "#domain/SQL"
import { unreachable } from "#domain/unreachable"
import type { QueryRunner } from "#spi/QueryRunner"

export type SqliteArg = string | number | null

export type SqliteObjectType = "table" | "index" | "view" | "trigger"
export type SqliteIndexOrigin = "c" | "u" | "pk"

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

export type SqlitePragmaIndexListRow = {
  seq: number
  name: string
  unique: 0 | 1
  origin: SqliteIndexOrigin
  partial: 0 | 1
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
  options: {
    indexOrigin?: SqliteIndexOrigin
  } = {},
): ObjectInfo {
  switch (row.type) {
    case "table":
      return makeTable(row.name, parent)
    case "index":
      return {
        type: "index",
        name: row.name,
        on: makeTable(row.tbl_name, parent),
        ...(options.indexOrigin === "pk" ? { automatic: true } : {}),
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

export function PragmaIndexList(tableName: string, database?: string): SQL<SqlitePragmaIndexListRow> {
  return unsafeRawSQL<SqlitePragmaIndexListRow>(
    `pragma ${database ? `${quoteSqliteIdentifier(database)}.` : ""}index_list(${quoteSqliteString(tableName)})`,
  )
}

export function parsePragmaDatabaseListRow(row: PragmaDatabaseListRow): DatabaseInfo {
  return {
    type: "database",
    name: row.name,
    file: row.file,
  }
}

export function createSqliteIndexOriginResolver<Config>(db: QueryRunner<Config>, database?: string) {
  const cache = new Map<string, Promise<Map<string, SqliteIndexOrigin>>>()

  return async (tableName: string, indexName: string): Promise<SqliteIndexOrigin | undefined> => {
    let tableOrigins = cache.get(tableName)
    if (!tableOrigins) {
      tableOrigins = db
        .query(PragmaIndexList(tableName, database))
        .then((rows) => new Map(rows.map((row) => [row.name, row.origin])))
      cache.set(tableName, tableOrigins)
    }

    return (await tableOrigins).get(indexName)
  }
}

export type SqliteSQL<Row> = SQL<Row>
export function sqlite<Row>(strings: TemplateStringsArray, ...values: SQLValue<SqliteArg>[]): SqliteSQL<Row> {
  return sql<Row, SqliteArg>(strings, ...values)
}

export function jsonb_patch<Row = unknown>(target: SQLValue<SqliteArg>, patch: SQLValue<SqliteArg>): SqliteSQL<Row> {
  return sqlite<Row>`jsonb(json_patch(json(${target}), json(${patch})))`
}

export async function explainSqliteQuery<Config>(db: QueryRunner<Config>, input: ExplainInput): Promise<ExplainResult> {
  throwIfAborted(input.abortSignal)

  try {
    await db.query(unsafeRawSQL(`EXPLAIN ${input.text}`), {
      abortSignal: input.abortSignal,
    })
    return {
      diagnostics: [],
      status: "ok",
    }
  } catch (_error) {
    const error = _error instanceof Error ? _error : new Error(String(_error))
    if (error.name === "AbortError") {
      throw error
    }

    const message = normalizeSqliteExplainErrorMessage(error.message)
    return {
      diagnostics: [
        {
          message,
          range: inferSqliteDiagnosticRange(input.text, message),
          severity: "error",
        },
      ],
      status: "invalid",
    }
  }
}

function normalizeSqliteExplainErrorMessage(message: string): string {
  return message.replace(/^SQLite3?\s+Error:\s*/i, "").trim()
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function quoteSqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function inferSqliteDiagnosticRange(
  text: string,
  message: string,
):
  | {
      start: number
      end: number
    }
  | undefined {
  const messageToken = parseSqliteDiagnosticToken(message)
  if (messageToken) {
    const tokenRange = findTokenRange(text, messageToken)
    if (tokenRange) {
      return tokenRange
    }
  }

  if (/incomplete input/i.test(message)) {
    return findTrailingTokenRange(text) ?? findLastVisibleCharRange(text)
  }

  return undefined
}

function parseSqliteDiagnosticToken(message: string): string | undefined {
  const nearMatch = message.match(/^near\s+["'`](.+?)["'`]:/i)
  if (nearMatch?.[1]) {
    return nearMatch[1]
  }

  const missingObjectMatch = message.match(/^no such (?:table|column):\s+(.+)$/i)
  if (missingObjectMatch?.[1]) {
    return missingObjectMatch[1]
  }

  const ambiguousColumnMatch = message.match(/^ambiguous column name:\s+(.+)$/i)
  if (ambiguousColumnMatch?.[1]) {
    return ambiguousColumnMatch[1]
  }

  const unrecognizedTokenMatch = message.match(/^unrecognized token:\s+(.+)$/i)
  if (unrecognizedTokenMatch?.[1]) {
    return stripBalancedQuotes(unrecognizedTokenMatch[1])
  }

  return undefined
}

function findTokenRange(
  text: string,
  rawToken: string,
):
  | {
      start: number
      end: number
    }
  | undefined {
  const token = stripBalancedQuotes(rawToken).trim()
  if (!token) {
    return undefined
  }

  const directIndex = text.toLowerCase().indexOf(token.toLowerCase())
  if (directIndex >= 0) {
    return {
      start: directIndex,
      end: directIndex + token.length,
    }
  }

  const lastSegment = token.split(".").at(-1)?.trim()
  if (lastSegment && lastSegment !== token) {
    return findTokenRange(text, lastSegment)
  }

  return undefined
}

function findTrailingTokenRange(text: string):
  | {
      start: number
      end: number
    }
  | undefined {
  const trailingWordMatch = /([A-Za-z_][A-Za-z0-9_$]*)\s*$/.exec(text)
  if (trailingWordMatch?.index !== undefined) {
    const trailingWord = trailingWordMatch[1]
    if (!trailingWord) {
      return undefined
    }
    return {
      start: trailingWordMatch.index,
      end: trailingWordMatch.index + trailingWord.length,
    }
  }

  const trailingNonWhitespaceMatch = /\S+\s*$/.exec(text)
  if (trailingNonWhitespaceMatch?.index !== undefined) {
    return {
      start: trailingNonWhitespaceMatch.index,
      end: trailingNonWhitespaceMatch.index + trailingNonWhitespaceMatch[0].trimEnd().length,
    }
  }

  return undefined
}

function findLastVisibleCharRange(text: string):
  | {
      start: number
      end: number
    }
  | undefined {
  const trimmed = text.trimEnd()
  if (!trimmed.length) {
    return undefined
  }

  return {
    start: trimmed.length - 1,
    end: trimmed.length,
  }
}

function stripBalancedQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) {
    return trimmed
  }

  const first = trimmed[0]
  const last = trimmed.at(-1)
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`) || (first === "`" && last === "`")) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function throwIfAborted(signal: AbortSignal): void {
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted()
    return
  }

  if (!signal.aborted) {
    return
  }

  const error = signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? "Aborted"))
  error.name = "AbortError"
  throw error
}
