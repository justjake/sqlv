import type { Connection } from "#domain/Connection"
import type { QueryExecution, QueryFlow, QueryInitiator } from "#domain/Log"
import type { Paginated, PaginatedParams, SQL } from "#domain/SQL"

export type QueryRunOptions = {
  abortSignal?: AbortSignal
  executionId?: string
  savedQueryId?: string
  initiator?: QueryInitiator
  parentFlowId?: string
}

export type QueryFlowInput = Omit<QueryFlow, "id"> & {
  id?: string
}

export interface QueryRunner<Config = unknown> {
  readonly connection: Connection<Config>
  withFlow(flow: QueryFlow): QueryRunner<Config>
  query<Row>(sql: SQL<Row>, options?: QueryRunOptions): Promise<Row[]>
  execute<Row>(sql: SQL<Row>, options?: QueryRunOptions): Promise<QueryExecution<Row>>
  iterate<Params extends PaginatedParams, Row>(
    paginated: Paginated<Params, Row>,
    params: Params,
    options?: QueryRunOptions,
  ): AsyncGenerator<Row[], Params>
}
