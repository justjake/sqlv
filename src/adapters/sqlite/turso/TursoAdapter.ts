import { stat } from "node:fs/promises"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import * as turso from "@tursodatabase/database"
import { type ExecuteRequest, type ExecuteSuccess, type Executor } from "#spi/Executor"
import {
  defaultStorageLocation,
  getExistingLocalStorageEncryptionKey,
} from "#platforms/bun/storage/createLocalStorage"
import { findLocalSqliteDatabaseFiles, localDatabaseSuggestionName } from "../localDiscovery"
import { aborter } from "#domain/defer"
import type { ExplainInput, ExplainResult } from "#domain/Explain"
import type { ObjectInfo } from "#domain/objects"
import { ident, type SQL } from "#domain/SQL"
import {
  type Adapter,
  type ConnectionFormValues,
  type ConnectionSpec,
  type ConnectionSuggestion,
} from "#spi/Adapter"
import type { QueryRunner } from "#spi/QueryRunner"

import type { SqliteArg } from "../sqlite"
import {
  createSqliteIndexOriginResolver,
  IterateSqliteSchema,
  explainSqliteQuery,
  parsePragmaDatabaseListRow,
  parseSqliteSchemaRow,
  PragmaDatabaseList,
} from "../sqlite"

type connectArgs = Parameters<typeof turso.connect>
type DatabaseOpts = NonNullable<connectArgs[1]>
type NativeTursoEncryptionOpts = NonNullable<DatabaseOpts["encryption"]>

declare module "../../../spi/Adapter" {
  interface ProtocolToAdapter {
    turso: TursoAdapter
  }
}

export type TursoCipherName = keyof typeof TURSO_ENCRYPTION_CIPHER
export type TursoEncryptionOpts = Omit<NativeTursoEncryptionOpts, "cipher"> & {
  cipher: NativeTursoEncryptionOpts["cipher"] | TursoCipherName
}
export type TursoConfig = { path: string } & Omit<DatabaseOpts, "encryption"> & {
    encryption?: TursoEncryptionOpts
  }
type TursoFeatures = {}

export class TursoAdapter implements Adapter<TursoConfig, SqliteArg, TursoFeatures> {
  readonly protocol = "turso"
  readonly treeSitterGrammar = "sql"
  readonly sqlFormatterLanguage = "sqlite"
  #searchDirectory: string
  #systemPath: string
  #loadSystemKey: () => Promise<string | undefined>

  constructor(
    args: {
      searchDirectory?: string
      systemPath?: string
      loadSystemKey?: () => Promise<string | undefined>
    } = {},
  ) {
    this.#searchDirectory = args.searchDirectory ?? process.cwd()
    this.#systemPath = args.systemPath ?? defaultStorageLocation()
    this.#loadSystemKey = args.loadSystemKey ?? (() => getExistingLocalStorageEncryptionKey())
  }

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

  getConnectionSpec(): ConnectionSpec<TursoConfig> {
    return {
      defaultName: "Encrypted SQLite",
      fields: [
        {
          description: "Local SQLite file path used by the embedded Turso engine.",
          key: "path",
          kind: "path",
          label: "Path",
          placeholder: "app.db",
          required: true,
        },
        {
          defaultValue: false,
          key: "readonly",
          kind: "boolean",
          label: "Readonly",
        },
        {
          defaultValue: false,
          key: "encryptionEnabled",
          kind: "boolean",
          label: "Encrypted",
        },
        {
          defaultValue: "aegis256",
          key: "encryptionCipher",
          kind: "select",
          label: "Cipher",
          options: [
            { label: "AES-128-GCM", value: "aes128gcm" },
            { label: "AES-256-GCM", value: "aes256gcm" },
            { label: "AEGIS-256", value: "aegis256" },
            { label: "AEGIS-256x2", value: "aegis256x2" },
            { label: "AEGIS-128L", value: "aegis128l" },
            { label: "AEGIS-128x2", value: "aegis128x2" },
            { label: "AEGIS-128x4", value: "aegis128x4" },
          ],
          visible: (values) => booleanField(values, "encryptionEnabled", false),
        },
        {
          description: "Hex-encoded encryption key.",
          key: "encryptionKey",
          kind: "secret",
          label: "Hex Key",
          placeholder: "64 hex chars",
          required: true,
          visible: (values) => booleanField(values, "encryptionEnabled", false),
        },
      ],
      label: "Turso SQLite",
      configToValues(config) {
        return {
          encryptionCipher:
            config.encryption && typeof config.encryption.cipher === "string" ? config.encryption.cipher : undefined,
          encryptionEnabled: config.encryption !== undefined,
          encryptionKey:
            config.encryption && "hexkey" in config.encryption && typeof config.encryption.hexkey === "string"
              ? config.encryption.hexkey
              : undefined,
          path: typeof config.path === "string" ? config.path : undefined,
          readonly: booleanOrUndefined(config.readonly),
        }
      },
      createConfig(values) {
        const encryptionEnabled = booleanField(values, "encryptionEnabled", false)
        return {
          encryption: encryptionEnabled
            ? {
                cipher: cipherField(values, "encryptionCipher", "aegis256"),
                hexkey: stringField(values, "encryptionKey", ""),
              }
            : undefined,
          path: stringField(values, "path", "app.db"),
          readonly: booleanField(values, "readonly", false),
        }
      },
      validate(draft) {
        const errors: Record<string, string | undefined> = {}
        if (!stringField(draft.values, "path", "").length) {
          errors.path = "Path is required."
        }
        if (!booleanField(draft.values, "encryptionEnabled", false)) {
          return errors
        }

        const hexkey = stringField(draft.values, "encryptionKey", "")
        if (!hexkey) {
          errors.encryptionKey = "Hex key is required when encryption is enabled."
        } else if (!/^[0-9a-f]+$/i.test(hexkey) || hexkey.length % 2 !== 0) {
          errors.encryptionKey = "Hex key must contain an even number of hexadecimal characters."
        }
        return errors
      },
    }
  }

  async findConnections(): Promise<Array<ConnectionSuggestion<TursoConfig>>> {
    const files = await findLocalSqliteDatabaseFiles(this.#searchDirectory)
    const suggestions: Array<ConnectionSuggestion<TursoConfig>> = files.map((path) => ({
      name: localDatabaseSuggestionName(path),
      config: {
        path,
      },
    }))
    const systemSuggestion = await this.#findSystemConnection()
    if (systemSuggestion) {
      suggestions.push(systemSuggestion)
    }

    return dedupeSuggestionsByPath(suggestions)
  }

  async #findSystemConnection(): Promise<ConnectionSuggestion<TursoConfig> | undefined> {
    if (!(await pathExists(this.#systemPath))) {
      return undefined
    }

    const hexkey = await this.#loadSystemKey()
    if (!hexkey) {
      return undefined
    }

    return {
      name: localDatabaseSuggestionName(this.#systemPath),
      config: {
        encryption: {
          cipher: "aegis256",
          hexkey,
        },
        path: this.#systemPath,
      },
    }
  }

  async fetchObjects(db: QueryRunner<TursoConfig>): Promise<ObjectInfo[]> {
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

  async explain(db: QueryRunner<TursoConfig>, input: ExplainInput): Promise<ExplainResult> {
    return explainSqliteQuery(db, input)
  }

  async connect(config: TursoConfig): Promise<TursoExecutor> {
    const { path, ...options } = config
    await mkdir(dirname(path), { recursive: true })
    const db = await turso.connect(path, normalizeDatabaseOptions(options))
    return new TursoExecutor(this, db)
  }

  renderSQL(sql: SQL<any>): { source: string; args: SqliteArg[] } {
    return { source: sql.toSource(), args: sql.getArgs() as SqliteArg[] }
  }
}

class TursoExecutor implements Executor {
  constructor(
    public readonly adapter: TursoAdapter,
    public readonly conn: turso.Database,
  ) {}

  async execute<Row>(req: ExecuteRequest<Row>): Promise<ExecuteSuccess<Row>> {
    const { source, args } = this.adapter.renderSQL(req.sql)
    using _ = aborter(req.abortSignal, () => this.conn.interrupt())
    const stmt = this.conn.prepare(source)
    const rows: Row[] = await stmt.all(...args)
    return { rows }
  }
}

const TURSO_ENCRYPTION_CIPHER = {
  aes128gcm: 0,
  aes256gcm: 1,
  aegis256: 2,
  aegis256x2: 3,
  aegis128l: 4,
  aegis128x2: 5,
  aegis128x4: 6,
} as const

function normalizeDatabaseOptions(options: Omit<TursoConfig, "path">): DatabaseOpts {
  if (!options.encryption) {
    return options
  }

  return {
    ...options,
    encryption: normalizeEncryptionOptions(options.encryption),
  }
}

function normalizeEncryptionOptions(encryption: TursoEncryptionOpts): NativeTursoEncryptionOpts {
  if (typeof encryption.cipher !== "string") {
    return encryption
  }

  const cipher = TURSO_ENCRYPTION_CIPHER[encryption.cipher.toLowerCase() as keyof typeof TURSO_ENCRYPTION_CIPHER]
  if (cipher === undefined) {
    throw new Error(`Unsupported Turso encryption cipher: ${encryption.cipher}`)
  }

  return {
    ...encryption,
    // The package types model a native enum that the ESM entrypoint does not expose.
    // At runtime the local driver expects the corresponding numeric discriminant.
    cipher: coerceEncryptionCipher(cipher),
  }
}

function coerceEncryptionCipher(cipher: number): NativeTursoEncryptionOpts["cipher"] {
  return cipher as unknown as NativeTursoEncryptionOpts["cipher"]
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function dedupeSuggestionsByPath(
  suggestions: Array<ConnectionSuggestion<TursoConfig>>,
): Array<ConnectionSuggestion<TursoConfig>> {
  const suggestionByPath = new Map<string, ConnectionSuggestion<TursoConfig>>()

  for (const suggestion of suggestions) {
    const path = typeof suggestion.config.path === "string" ? suggestion.config.path : undefined
    if (!path) {
      continue
    }
    suggestionByPath.set(path, suggestion)
  }

  return [...suggestionByPath.values()].toSorted((left, right) => left.name.localeCompare(right.name))
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

function cipherField(
  values: ConnectionFormValues,
  key: string,
  defaultValue: TursoCipherName,
): TursoEncryptionOpts["cipher"] {
  return stringField(values, key, defaultValue) as TursoEncryptionOpts["cipher"]
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}
