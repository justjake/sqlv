import * as turso from "@tursodatabase/database"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { registerAdapter, type Adapter } from "../interface/Adapter"
import { type ExecuteRequest, type ExecuteSuccess, type Executor } from "../interface/Executor"
import { aborter } from "../types/defer"
import type { ObjectInfo } from "../types/objects"
import type { QueryService } from "../types/QueryService"
import { ident, type SQL } from "../types/SQL"
import type { SqliteArg } from "./sqlite"
import { IterateSqliteSchema, parsePragmaDatabaseListRow, parseSqliteSchemaRow, PragmaDatabaseList } from "./sqlite"

type connectArgs = Parameters<typeof turso.connect>
type DatabaseOpts = NonNullable<connectArgs[1]>

declare module "../interface/Adapter" {
  interface ProtocolToAdapter {
    turso: TursoAdapter
  }
}

export type TursoConfig = { path: string } & DatabaseOpts
type TursoFeatures = {}

export class TursoAdapter implements Adapter<TursoConfig, SqliteArg, TursoFeatures> {
  protocol = "turso" as const

  describeConfig(config: TursoConfig): string {
    let desc = config.path
    const attrs = [config.readonly && "readonly", config.encryption && `encrypted(${config.encryption.cipher})`]
      .filter(Boolean)
      .join(" ")
    if (attrs) {
      desc += ` (${attrs})`
    }
    return desc
  }

  features = {}

  async fetchObjects(db: QueryService<TursoConfig, SqliteArg>): Promise<ObjectInfo[]> {
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

  async connect(config: TursoConfig): Promise<TursoExecutor> {
    const { path, ...options } = config
    await mkdir(dirname(path), { recursive: true })
    const db = await turso.connect(path, options)
    return new TursoExecutor(this, db)
  }

  renderSQL(sql: SQL<any, SqliteArg>): { source: string; args: SqliteArg[] } {
    return { source: sql.toSource(), args: sql.getArgs() }
  }
}

class TursoExecutor implements Executor<SqliteArg> {
  constructor(
    public readonly adapter: TursoAdapter,
    public readonly conn: turso.Database,
  ) {}

  async execute<Row>(req: ExecuteRequest<Row, SqliteArg>): Promise<ExecuteSuccess<Row>> {
    const { source, args } = this.adapter.renderSQL(req.sql)
    using _ = aborter(req.abortSignal, () => this.conn.interrupt())
    const rows: Row[] = await this.conn.prepare(source).bind(args).all()
    return { rows }
  }
}

registerAdapter(new TursoAdapter())
