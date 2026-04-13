import type { Paginated, PaginatedParams, SQL } from "../types/SQL"
import type { Connection } from "./Connection"

export interface QueryService<Config = unknown, Args = unknown> {
  readonly connection: Connection<Config>
  query<Row>(sql: SQL<Row, Args>): Promise<Row[]>
  iterate<Params extends PaginatedParams, Row>(
    paginated: Paginated<Params, Row, Args>,
    params: Params,
  ): AsyncGenerator<Row[], Params>
  // all<Params extends PaginatedParams, Row>(paginated: Paginated<Params, Row, Args>, params: Params): Promise<Row[]>
}
