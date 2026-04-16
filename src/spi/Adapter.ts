import type { ExplainInput, ExplainResult } from "#domain/Explain"
import type { ObjectInfo } from "#domain/objects"
import type { Identifier, SQL } from "#domain/SQL"
import type { QueryRunner } from "./QueryRunner"
import type { ExecuteResult, Executor } from "./Executor"

export type Feature<T> = {
  // TODO: more stuff for mcp?
  load(executor: Executor): Promise<T>
}

export type ConnectionFormValue = string | boolean | undefined
export type ConnectionFormValues = Record<string, ConnectionFormValue>

type ConnectionFieldBase = {
  key: string
  label: string
  description?: string
  visible?: (values: ConnectionFormValues) => boolean
}

export type ConnectionTextField = ConnectionFieldBase & {
  kind: "text" | "path" | "secret"
  defaultValue?: string
  placeholder?: string
  required?: boolean
}

export type ConnectionBooleanField = ConnectionFieldBase & {
  kind: "boolean"
  defaultValue?: boolean
}

export type ConnectionSelectField = ConnectionFieldBase & {
  kind: "select"
  defaultValue?: string
  options: Array<{
    label: string
    value: string
  }>
}

export type ConnectionField = ConnectionTextField | ConnectionBooleanField | ConnectionSelectField

export type ConnectionSpecDraft = {
  name: string
  values: ConnectionFormValues
}

export type ConnectionSuggestion<Config = {}> = {
  name: string
  config: Partial<Config>
}

export type ConnectionSpec<Config = {}> = {
  label: string
  defaultName?: string
  fields: ConnectionField[]
  createConfig(values: ConnectionFormValues): Config
  configToValues?(config: Partial<Config>): ConnectionFormValues
  fromURI?(uri: string): Config
  toURI?(config: Config): string
  validate?: (draft: ConnectionSpecDraft) => Record<string, string | undefined>
}

export type Adapter<Config = {}, Arg = {}, F extends Record<string, Feature<unknown>> = {}> = {
  protocol: string
  treeSitterGrammar?: string
  sqlFormatterLanguage?: string
  connect(config: Config): Promise<Executor>
  describeConfig(config: Config): string
  fetchObjects(db: QueryRunner<Config>): Promise<ObjectInfo[]>
  explain?(db: QueryRunner<Config>, input: ExplainInput): Promise<ExplainResult>
  findConnections?(): Promise<Array<ConnectionSuggestion<Config>>>
  renderSQL(sql: SQL<any>): { source: string; args: Arg[] }
  getConnectionSpec?: () => ConnectionSpec<Config>
  sample?: {
    canSample(ident: Identifier, db: QueryRunner<Config>): Promise<boolean>
    sample<Row>(ident: Identifier, db: QueryRunner<Config>): Promise<ExecuteResult<Row>>
  }
  features: F
}

export type AdapterConfig<T> = T extends Adapter<infer Config, any, any> ? Config : never

export interface ProtocolToAdapter {}
export type Protocol = keyof ProtocolToAdapter
export type ProtocolConfig<P extends Protocol> = AdapterConfig<ProtocolToAdapter[P]>
export type RegisteredAdapter<P extends Protocol = Protocol> = Adapter<ProtocolConfig<P>, any, any> & { protocol: P }
export type AnyAdapter = RegisteredAdapter

export class AdapterRegistry {
  #adapterMap: Partial<Record<Protocol, AnyAdapter>> = {}

  constructor(adapters: AnyAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter)
    }
  }

  register<P extends Protocol>(adapter: RegisteredAdapter<P>): this {
    if (adapter.protocol in this.#adapterMap) {
      throw new Error(`Adapter already registered for protocol ${adapter.protocol}`)
    }

    this.#adapterMap[adapter.protocol] = adapter
    return this
  }

  has(protocol: Protocol): boolean {
    return protocol in this.#adapterMap
  }

  get<P extends Protocol>(protocol: P): RegisteredAdapter<P> {
    const adapter = this.#adapterMap[protocol]
    if (!adapter) {
      throw new Error(`No adapter registered for protocol ${protocol}`)
    }
    if (!matchesProtocol(adapter, protocol)) {
      throw new Error(`Adapter protocol mismatch for ${protocol}`)
    }
    return adapter
  }

  list(): AnyAdapter[] {
    return Object.values(this.#adapterMap).filter((adapter): adapter is AnyAdapter => adapter !== undefined)
  }
}

function matchesProtocol<P extends Protocol>(adapter: AnyAdapter, protocol: P): adapter is RegisteredAdapter<P> {
  return adapter.protocol === protocol
}
