import type { Paginated, PaginatedParams, SQL } from "../types/SQL"
import type { Connection } from "./Connection"

export interface QueryService<Config = unknown> {
  readonly connection: Connection<Config>
  query<Row>(sql: SQL<Row>): Promise<Row[]>
  iterate<Params extends PaginatedParams, Row>(
    paginated: Paginated<Params, Row>,
    params: Params,
  ): AsyncGenerator<Row[], Params>
}
