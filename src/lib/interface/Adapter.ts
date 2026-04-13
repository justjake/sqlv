import type { Identifier } from "typescript"
import type { ObjectInfo } from "../types/objects"
import type { QueryService } from "../types/QueryService"
import type { SQL } from "../types/SQL"
import type { ExecuteResult, Executor } from "./Executor"

export type Feature<T, Arg> = {
  // TODO: more stuff for mcp?
  load(executor: Executor<Arg>): Promise<T>
}

export type Adapter<Config = {}, Arg = {}, F extends Record<string, Feature<unknown, Arg>> = {}> = {
  protocol: string
  connect(config: Config): Promise<Executor<Arg>>
  describeConfig(config: Config): string
  fetchObjects(db: QueryService<Config, Arg>): Promise<ObjectInfo[]>
  renderSQL(sql: SQL<any, Arg>): { source: string; args: Arg[] }
  sample?: {
    canSample(ident: Identifier, db: QueryService<Config, Arg>): Promise<boolean>
    sample<Row>(ident: Identifier, db: QueryService<Config, Arg>): Promise<ExecuteResult<Row, Arg>>
  }
  features: F
}

export type AdapterConfig<T> = T extends Adapter<infer Config, any, any> ? Config : never

export interface ProtocolToAdapter {}
export type Protocol = keyof ProtocolToAdapter
export type ProtocolConfig<P extends Protocol> = AdapterConfig<ProtocolToAdapter[P]>

const adapterMap: Partial<Record<Protocol, Adapter>> = {}

export function registerAdapter(adapter: Adapter<any, any, any>) {
  if (adapter.protocol in adapterMap) {
    throw new Error(`Adapter already registered for protocol ${adapter.protocol}`)
  }

  adapterMap[adapter.protocol as Protocol] = adapter
}

export function getAdapter<P extends Protocol>(protocol: P): Adapter<ProtocolConfig<P>, any, {}> {
  const adapter = adapterMap[protocol]
  if (!adapter) {
    throw new Error(`No adapter registered for protocol ${protocol}`)
  }
  return adapter
}
