import { Client, Query, type ClientConfig, type QueryResult } from "pg"
import { parseIntoClientConfig } from "pg-connection-string"
import {
  type Adapter,
  type ConnectionFormValues,
  type ConnectionSpec,
  type ConnectionSuggestion,
} from "../../spi/Adapter"
import { type ExecuteRequest, type ExecuteSuccess, type Executor } from "../../spi/Executor"
import { findLocalPostgresPorts, probePostgresPort } from "./localDiscovery"
import { aborter } from "../../domain/defer"
import type {
  DatabaseInfo,
  MaterializedViewInfo,
  ObjectInfo,
  QueryableObjectInfo,
  SchemaInfo,
  TableInfo,
  ViewInfo,
} from "../../domain/objects"
import { SQL, sql, unsafeRawSQL, type SQLValue } from "../../domain/SQL"
import type { ExplainInput, ExplainResult } from "../../domain/Explain"
import type { QueryRunner } from "../../spi/QueryRunner"

export type PostgresArg = string | number | boolean | bigint | Uint8Array | Date | null
export type PostgresSQL<Row> = SQL<Row>

export function postgres<Row>(strings: TemplateStringsArray, ...values: SQLValue<PostgresArg>[]): PostgresSQL<Row> {
  return sql<Row, PostgresArg>(strings, ...values)
}

export type PostgresConfig = ClientConfig
type PostgresFeatures = {}

export type PostgresqlProtocolResolution = {
  protocol: "postgresql"
  config: PostgresConfig
}

export function resolvePostgresConfig(connectionString: string): PostgresConfig {
  return {
    connectionString,
    ...parseIntoClientConfig(connectionString),
  }
}

export const postgresqlProtocolResolver = {
  protocol: "postgresql" as const,
  resolve(input: string | URL): PostgresqlProtocolResolution {
    const connectionString = typeof input === "string" ? input : input.toString()
    return {
      protocol: "postgresql",
      config: resolvePostgresConfig(connectionString),
    }
  },
}

declare module "../../spi/Adapter" {
  interface ProtocolToAdapter {
    postgresql: PostgresAdapter
  }
}

export class PostgresAdapter implements Adapter<PostgresConfig, PostgresArg, PostgresFeatures> {
  readonly protocol = "postgresql"
  readonly treeSitterGrammar = "sql"
  readonly sqlFormatterLanguage = "postgresql"
  #findPorts: () => Promise<number[]>

  features = {}

  constructor(
    args: {
      findPorts?: () => Promise<number[]>
      listListeningPorts?: () => Promise<number[]>
      probePort?: (port: number) => Promise<boolean>
    } = {},
  ) {
    this.#findPorts =
      args.findPorts ??
      (() =>
        findLocalPostgresPorts({
          listListeningPorts: args.listListeningPorts,
          probePort: args.probePort ?? probePostgresPort,
        }))
  }

  describeConfig(config: PostgresConfig): string {
    const database = config.database ?? "postgres"
    const host = config.host ?? "localhost"
    const port = config.port ?? 5432
    const authority = [config.user, `${host}:${port}`].filter(Boolean).join("@")
    const attrs = [config.ssl && "ssl"].filter(Boolean).join(" ")

    return attrs ? `${authority}/${database} (${attrs})` : `${authority}/${database}`
  }

  getConnectionSpec(): ConnectionSpec<PostgresConfig> {
    return {
      defaultName: "PostgreSQL",
      fields: [
        {
          defaultValue: "localhost",
          key: "host",
          kind: "text",
          label: "Host",
          placeholder: "localhost",
        },
        {
          defaultValue: "5432",
          key: "port",
          kind: "text",
          label: "Port",
          placeholder: "5432",
        },
        {
          defaultValue: "postgres",
          key: "database",
          kind: "text",
          label: "Database",
          placeholder: "postgres",
          required: true,
        },
        {
          key: "user",
          kind: "text",
          label: "User",
          placeholder: "postgres",
        },
        {
          key: "password",
          kind: "secret",
          label: "Password",
        },
        {
          defaultValue: false,
          key: "ssl",
          kind: "boolean",
          label: "SSL",
        },
        {
          key: "application_name",
          kind: "text",
          label: "Application Name",
          placeholder: "sqlv",
        },
      ],
      label: "PostgreSQL",
      configToValues(config) {
        const resolved = normalizeSuggestedPostgresConfig(config)
        return {
          application_name: typeof resolved.application_name === "string" ? resolved.application_name : undefined,
          database: typeof resolved.database === "string" ? resolved.database : undefined,
          host: typeof resolved.host === "string" ? resolved.host : undefined,
          password: typeof resolved.password === "string" ? resolved.password : undefined,
          port:
            typeof resolved.port === "number"
              ? String(resolved.port)
              : typeof resolved.port === "string"
                ? resolved.port
                : undefined,
          ssl: booleanOrUndefined(resolved.ssl),
          user: typeof resolved.user === "string" ? resolved.user : undefined,
        }
      },
      createConfig(values) {
        return createPostgresConfig(values)
      },
      fromURI(uri) {
        return resolvePostgresConfig(uri)
      },
      toURI(config) {
        return toPostgresURI(config)
      },
      validate(draft) {
        const errors: Record<string, string | undefined> = {}
        if (!stringField(draft.values, "database", "postgres")) {
          errors.database = "Database is required."
        }

        const port = stringField(draft.values, "port", "5432")
        if (port && !/^\d+$/.test(port)) {
          errors.port = "Port must be a number."
        }

        return errors
      },
    }
  }

  async findConnections(): Promise<Array<ConnectionSuggestion<PostgresConfig>>> {
    const ports = await this.#findPorts()
    return ports.map((port) => ({
      name: `localhost:${port}`,
      config: {
        database: "postgres",
        host: "localhost",
        port,
      },
    }))
  }

  async fetchObjects(db: QueryRunner<PostgresConfig>): Promise<ObjectInfo[]> {
    const databaseRow = (await db.query(CurrentDatabaseQuery))[0]
    if (!databaseRow) {
      throw new Error("Postgres introspection did not return a current database name")
    }
    const databaseName = databaseRow.name
    const schemas = await db.query(ListSchemasQuery)
    const relations = await db.query(ListRelationsQuery)
    const indexes = await db.query(ListIndexesQuery)
    const triggers = await db.query(ListTriggersQuery)

    const result: ObjectInfo[] = [
      {
        type: "database",
        name: databaseName,
      } satisfies DatabaseInfo,
      ...schemas.map(
        (row) =>
          ({
            type: "schema",
            database: databaseName,
            name: row.name,
          }) satisfies SchemaInfo,
      ),
      ...relations.map((row) => makeQueryableObject(databaseName, row.schema, row.name, row.kind)),
      ...indexes.map((row) => ({
        type: "index" as const,
        automatic: row.automatic,
        name: row.name,
        on: makeQueryableObject(databaseName, row.schema, row.table_name, row.table_kind),
      })),
      ...triggers.map((row) => ({
        type: "trigger" as const,
        on: makeQueryableObject(databaseName, row.schema, row.table_name, row.table_kind),
      })),
    ]

    return result
  }

  async explain(db: QueryRunner<PostgresConfig>, input: ExplainInput): Promise<ExplainResult> {
    input.abortSignal?.throwIfAborted()

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

      const position = parsePostgresErrorPosition(error)
      return {
        diagnostics: [
          {
            message: error.message,
            range: position === undefined ? undefined : { start: position, end: position + 1 },
            severity: "error",
          },
        ],
        status: "invalid",
      }
    }
  }

  async connect(config: PostgresConfig): Promise<PostgresExecutor> {
    const client = new Client(config)
    await client.connect()
    return new PostgresExecutor(this, client)
  }

  renderSQL(sql: SQL<any>): { source: string; args: PostgresArg[] } {
    return {
      source: sql.toSource(),
      args: sql.getArgs() as PostgresArg[],
    }
  }
}

class PostgresExecutor implements Executor {
  constructor(
    public readonly adapter: PostgresAdapter,
    public readonly conn: Client,
  ) {}

  async execute<Row>(req: ExecuteRequest<Row>): Promise<ExecuteSuccess<Row>> {
    req.abortSignal?.throwIfAborted()
    const { source, args } = this.adapter.renderSQL(req.sql)

    let rejectQuery!: (error: Error) => void
    const query = new Query(
      {
        text: source,
        values: args,
      },
      (error, result) => {
        if (error) {
          rejectQuery(error)
          return
        }

        resolveQuery(result)
      },
    )
    let resolveQuery!: (result: QueryResult) => void
    const resultPromise = new Promise<QueryResult>((resolve, reject) => {
      resolveQuery = resolve
      rejectQuery = reject
    })

    using _ = aborter(req.abortSignal, () => {
      this.cancel(query)
    })

    this.conn.query(query)
    const result = await resultPromise
    req.abortSignal?.throwIfAborted()
    return { rows: result.rows as Row[] }
  }

  private cancel(query: Query<any, any>) {
    const cancelCapableClient = this.conn as Client & {
      cancel(client: Client, query: Query<any, any>): void
    }
    cancelCapableClient.cancel(this.conn, query)
  }
}

type CurrentDatabaseRow = {
  name: string
}

const CurrentDatabaseQuery = postgres<CurrentDatabaseRow>`SELECT current_database() AS name`

type SchemaRow = {
  name: string
}

const ListSchemasQuery = postgres<SchemaRow>`
  SELECT nspname AS name
  FROM pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema')
    AND nspname NOT LIKE 'pg_toast%'
  ORDER BY nspname ASC
`

type RelationRow = {
  schema: string
  name: string
  kind: "r" | "v" | "m"
}

const ListRelationsQuery = postgres<RelationRow>`
  SELECT
    n.nspname AS schema,
    c.relname AS name,
    c.relkind AS kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'v', 'm')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
  ORDER BY n.nspname ASC, c.relname ASC
`

type IndexRow = {
  schema: string
  name: string
  table_name: string
  table_kind: "r" | "v" | "m"
  automatic: boolean
}

const ListIndexesQuery = postgres<IndexRow>`
  SELECT
    ns.nspname AS schema,
    idx.relname AS name,
    tbl.relname AS table_name,
    tbl.relkind AS table_kind,
    COALESCE(con.contype IN ('p', 'u', 'x'), false) AS automatic
  FROM pg_index i
  JOIN pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
  WHERE tbl.relkind IN ('r', 'v', 'm')
    AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    AND ns.nspname NOT LIKE 'pg_toast%'
  ORDER BY ns.nspname ASC, tbl.relname ASC, idx.relname ASC
`

type TriggerRow = {
  schema: string
  table_name: string
  table_kind: "r" | "v" | "m"
}

const ListTriggersQuery = postgres<TriggerRow>`
  SELECT
    ns.nspname AS schema,
    tbl.relname AS table_name,
    tbl.relkind AS table_kind
  FROM pg_trigger tg
  JOIN pg_class tbl ON tbl.oid = tg.tgrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE NOT tg.tgisinternal
    AND tbl.relkind IN ('r', 'v', 'm')
    AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
    AND ns.nspname NOT LIKE 'pg_toast%'
  ORDER BY ns.nspname ASC, tbl.relname ASC, tg.tgname ASC
`

function createPostgresConfig(values: ConnectionFormValues): PostgresConfig {
  const config: PostgresConfig = {
    application_name: optionalStringField(values, "application_name"),
    connectionString: undefined,
    database: stringField(values, "database", "postgres"),
    host: stringField(values, "host", "localhost"),
    password: optionalStringField(values, "password"),
    port: integerField(values, "port", 5432),
    ssl: booleanField(values, "ssl", false),
    user: optionalStringField(values, "user"),
  }

  return {
    ...config,
    connectionString: toPostgresURI(config),
  }
}

function normalizeSuggestedPostgresConfig(config: Partial<PostgresConfig>): Partial<PostgresConfig> {
  if (!config.connectionString || config.host || config.port || config.database || config.user || config.password) {
    return config
  }

  return resolvePostgresConfig(config.connectionString)
}

function toPostgresURI(config: PostgresConfig): string {
  if (typeof config.connectionString === "string" && config.connectionString.length > 0) {
    return config.connectionString
  }

  const database = config.database ?? "postgres"
  const host = config.host ?? "localhost"
  const query = new URLSearchParams()
  const socketHost = host.startsWith("/")

  if (socketHost) {
    query.set("host", host)
    if (config.port !== undefined) {
      query.set("port", String(config.port))
    }
  }
  if (!config.user && typeof config.password === "string") {
    query.set("password", config.password)
  }

  if (config.application_name) {
    query.set("application_name", config.application_name)
  }
  if (config.client_encoding) {
    query.set("client_encoding", config.client_encoding)
  }
  if (config.options) {
    query.set("options", config.options)
  }
  if (config.fallback_application_name) {
    query.set("fallback_application_name", config.fallback_application_name)
  }
  if (config.ssl === true) {
    query.set("ssl", "true")
  } else if (config.ssl === false) {
    query.set("sslmode", "disable")
  } else if (config.ssl && typeof config.ssl === "object") {
    if (config.ssl.rejectUnauthorized === false) {
      query.set("sslmode", "no-verify")
    } else {
      query.set("ssl", "true")
    }
  }

  const authority = formatPostgresAuthority(config, socketHost ? "" : host)
  const pathname = `/${encodeURIComponent(database)}`
  const search = query.size > 0 ? `?${query.toString()}` : ""

  if (authority.length > 0) {
    return `postgresql://${authority}${pathname}${search}`
  }

  return `postgresql://${pathname}${search}`
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function formatPostgresAuthority(config: PostgresConfig, host: string): string {
  const user = typeof config.user === "string" && config.user.length > 0 ? encodeURIComponent(config.user) : ""
  const password =
    user.length > 0 && typeof config.password === "string" ? `:${encodeURIComponent(config.password)}` : ""
  const userInfo = user.length > 0 ? `${user}${password}@` : ""
  const formattedHost = formatPostgresAuthorityHost(host)
  const port = host.length > 0 && config.port !== undefined ? `:${config.port}` : ""
  return `${userInfo}${formattedHost}${port}`
}

function formatPostgresAuthorityHost(host: string): string {
  if (!host.length) {
    return ""
  }
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`
  }
  return host
}

function makeQueryableObject(
  database: string,
  schema: string,
  name: string,
  kind: "r" | "v" | "m",
): QueryableObjectInfo {
  switch (kind) {
    case "r":
      return {
        type: "table",
        database,
        schema,
        name,
      } satisfies TableInfo
    case "v":
      return {
        type: "view",
        database,
        schema,
        name,
      } satisfies ViewInfo
    case "m":
      return {
        type: "matview",
        database,
        schema,
        name,
      } satisfies MaterializedViewInfo
  }
}

function parsePostgresErrorPosition(error: Error): number | undefined {
  const maybePosition = (error as Error & { position?: string }).position
  if (!maybePosition || !/^\d+$/.test(maybePosition)) {
    return undefined
  }

  return Math.max(0, Number.parseInt(maybePosition, 10) - 1)
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

function optionalStringField(values: ConnectionFormValues, key: string): string | undefined {
  const value = values[key]
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function integerField(values: ConnectionFormValues, key: string, defaultValue: number): number {
  const value = values[key]
  if (typeof value !== "string") {
    return defaultValue
  }

  const trimmed = value.trim()
  if (!trimmed.length || !/^\d+$/.test(trimmed)) {
    return defaultValue
  }

  return Number.parseInt(trimmed, 10)
}
