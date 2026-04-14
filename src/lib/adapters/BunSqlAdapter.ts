import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { registerAdapter, type Adapter } from "../interface/Adapter"
import { type ExecuteRequest, type ExecuteSuccess, type Executor } from "../interface/Executor"
import type { ObjectInfo } from "../types/objects"
import type { QueryService } from "../types/QueryService"
import { ident, type SQL } from "../types/SQL"
import type { SqliteArg } from "./sqlite"
import { IterateSqliteSchema, parsePragmaDatabaseListRow, parseSqliteSchemaRow, PragmaDatabaseList } from "./sqlite"

type ConnectArgs = ConstructorParameters<typeof Database>
type DatabaseOpts = Exclude<ConnectArgs[1], number | undefined>

declare module "../interface/Adapter" {
  interface ProtocolToAdapter {
    bunsqlite: BunSqlAdapter
  }
}

export type BunSqlConfig = { path: string } & DatabaseOpts
type BunSqlFeatures = {}

export class BunSqlAdapter implements Adapter<BunSqlConfig, SqliteArg, BunSqlFeatures> {
  protocol = "bunsqlite" as const

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

  async fetchObjects(db: QueryService<BunSqlConfig>): Promise<ObjectInfo[]> {
    const databaseList = await db.query(PragmaDatabaseList)
    const databaseInfos = databaseList.map(parsePragmaDatabaseListRow)
    const result: ObjectInfo[] = [...databaseInfos]
    for (const namespace of databaseInfos) {
      for await (const rows of db.iterate(IterateSqliteSchema, {
        schemaTable: ident("sqlite_schema", {
          schema: namespace.name,
        }),
        limit: 500,
        cursor: { type: "", name: "" },
      })) {
        rows.forEach((r) => result.push(parseSqliteSchemaRow({ database: namespace.name, schema: undefined }, r)))
      }
    }
    return result
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

function withoutUndefined(options: DatabaseOpts): DatabaseOpts {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as DatabaseOpts
}

registerAdapter(new BunSqlAdapter())
