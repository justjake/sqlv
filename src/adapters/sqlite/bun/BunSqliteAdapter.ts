import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
  type Adapter,
  type ConnectionFormValues,
  type ConnectionSpec,
  type ConnectionSuggestion,
} from "../../../spi/Adapter"
import { type ExecuteRequest, type ExecuteSuccess, type Executor } from "../../../spi/Executor"
import { findLocalSqliteDatabaseFiles, localDatabaseSuggestionName } from "../localDiscovery"
import type { ExplainInput, ExplainResult } from "../../../model/Explain"
import type { ObjectInfo } from "../../../model/objects"
import { ident, type SQL } from "../../../model/SQL"
import type { QueryRunner } from "../../../spi/QueryRunner"
import type { SqliteArg } from "../sqlite"
import {
  createSqliteIndexOriginResolver,
  IterateSqliteSchema,
  explainSqliteQuery,
  parsePragmaDatabaseListRow,
  parseSqliteSchemaRow,
  PragmaDatabaseList,
} from "../sqlite"

type ConnectArgs = ConstructorParameters<typeof Database>
type DatabaseOpts = Exclude<ConnectArgs[1], number | undefined>

declare module "../../../spi/Adapter" {
  interface ProtocolToAdapter {
    bunsqlite: BunSqlAdapter
  }
}

export type BunSqlConfig = { path: string } & DatabaseOpts
type BunSqlFeatures = {}

export class BunSqlAdapter implements Adapter<BunSqlConfig, SqliteArg, BunSqlFeatures> {
  readonly protocol = "bunsqlite"
  readonly treeSitterGrammar = "sql"
  readonly sqlFormatterLanguage = "sqlite"
  #searchDirectory: string

  constructor(args: { searchDirectory?: string } = {}) {
    this.#searchDirectory = args.searchDirectory ?? process.cwd()
  }

  describeConfig(config: BunSqlConfig): string {
    let desc = config.path || ":memory:"
    const attrs = [
      config.readonly && "readonly",
      config.create === false && "create=false",
      config.readwrite === false && "readwrite=false",
      config.safeIntegers && "safeIntegers",
      config.strict && "strict",
    ]
      .filter(Boolean)
      .join(" ")
    if (attrs) {
      desc += ` (${attrs})`
    }
    return desc
  }

  features = {}

  getConnectionSpec(): ConnectionSpec<BunSqlConfig> {
    return {
      defaultName: "In-memory SQLite",
      fields: [
        {
          defaultValue: ":memory:",
          description: "Use :memory: for an ephemeral database or provide a file path.",
          key: "path",
          kind: "path",
          label: "Path",
          placeholder: ":memory:",
        },
        {
          defaultValue: false,
          key: "readonly",
          kind: "boolean",
          label: "Readonly",
        },
        {
          defaultValue: true,
          key: "create",
          kind: "boolean",
          label: "Create File",
        },
        {
          defaultValue: true,
          key: "readwrite",
          kind: "boolean",
          label: "Readwrite",
        },
        {
          defaultValue: false,
          key: "safeIntegers",
          kind: "boolean",
          label: "Safe Integers",
        },
        {
          defaultValue: false,
          key: "strict",
          kind: "boolean",
          label: "Strict",
        },
      ],
      label: "Bun SQLite",
      configToValues(config) {
        return {
          create: booleanOrUndefined(config.create),
          path: typeof config.path === "string" ? config.path : undefined,
          readonly: booleanOrUndefined(config.readonly),
          readwrite: booleanOrUndefined(config.readwrite),
          safeIntegers: booleanOrUndefined(config.safeIntegers),
          strict: booleanOrUndefined(config.strict),
        }
      },
      createConfig(values) {
        return {
          create: booleanField(values, "create", true),
          path: stringField(values, "path", ":memory:"),
          readonly: booleanField(values, "readonly", false),
          readwrite: booleanField(values, "readwrite", true),
          safeIntegers: booleanField(values, "safeIntegers", false),
          strict: booleanField(values, "strict", false),
        }
      },
    }
  }

  async findConnections(): Promise<Array<ConnectionSuggestion<BunSqlConfig>>> {
    const files = await findLocalSqliteDatabaseFiles(this.#searchDirectory)
    return files.map((path) => ({
      name: localDatabaseSuggestionName(path),
      config: {
        path,
      },
    }))
  }

  async fetchObjects(db: QueryRunner<BunSqlConfig>): Promise<ObjectInfo[]> {
    const databaseList = await db.query(PragmaDatabaseList)
    const databaseInfos = databaseList.map(parsePragmaDatabaseListRow)
    const result: ObjectInfo[] = [...databaseInfos]
    for (const namespace of databaseInfos) {
      const getIndexOrigin = createSqliteIndexOriginResolver(db, namespace.name)

      for await (const rows of db.iterate(IterateSqliteSchema, {
        schemaTable: ident("sqlite_schema", {
          schema: namespace.name,
        }),
        limit: 500,
        cursor: { type: "", name: "" },
      })) {
        for (const row of rows) {
          const indexOrigin = row.type === "index" ? await getIndexOrigin(row.tbl_name, row.name) : undefined

          result.push(parseSqliteSchemaRow({ database: namespace.name, schema: undefined }, row, { indexOrigin }))
        }
      }
    }
    return result
  }

  async explain(db: QueryRunner<BunSqlConfig>, input: ExplainInput): Promise<ExplainResult> {
    return explainSqliteQuery(db, input)
  }

  async connect(config: BunSqlConfig): Promise<BunSqlExecutor> {
    const { path, ...options } = config
    const filename = path || ":memory:"
    if (!isInMemoryDatabase(filename)) {
      await mkdir(dirname(filename), { recursive: true })
    }
    const databaseOptions = withoutUndefined(options)
    const db = new Database(filename, Object.keys(databaseOptions).length > 0 ? databaseOptions : undefined)
    return new BunSqlExecutor(this, db)
  }

  renderSQL(sql: SQL<any>): { source: string; args: SqliteArg[] } {
    return { source: sql.toSource(), args: sql.getArgs() as SqliteArg[] }
  }
}

class BunSqlExecutor implements Executor {
  constructor(
    public readonly adapter: BunSqlAdapter,
    public readonly conn: Database,
  ) {}

  async execute<Row>(req: ExecuteRequest<Row>): Promise<ExecuteSuccess<Row>> {
    req.abortSignal?.throwIfAborted()
    const { source, args } = this.adapter.renderSQL(req.sql)
    using stmt = this.conn.prepare<Row, SqliteArg[]>(source)
    const rows = stmt.all(...args)
    req.abortSignal?.throwIfAborted()
    return { rows }
  }
}

function isInMemoryDatabase(path: string): boolean {
  return path === "" || path === ":memory:"
}

function withoutUndefined<T extends object>(options: T): Partial<T> {
  const result: Partial<T> = {}
  for (const key in options) {
    const value = options[key]
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function booleanField(values: ConnectionFormValues, key: string, defaultValue: boolean): boolean {
  const value = values[key]
  return typeof value === "boolean" ? value : defaultValue
}

function stringField(values: ConnectionFormValues, key: string, defaultValue: string): string {
  const value = values[key]
  if (typeof value !== "string") {
    return defaultValue
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : defaultValue
}
