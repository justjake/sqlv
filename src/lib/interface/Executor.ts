import type { Result } from "../types/Result"
import type { SQL } from "../types/SQL"

// TODO: we should remove pretty mich everything fancy from here, since probably
// shared tracking middleware can provide all the standard complexity.
//
// that way implementers have it very easy
export type ExecuteRequest<Row, Arg> = {
  // requestId: string
  abortSignal: AbortSignal | undefined
  sql: SQL<Row, Arg>
  // queryName?: string
  // sensitive?: boolean
  // record?: boolean
}

export type ExecuteSuccess<Row> = {
  rows: Row[]
}

export class ExecuteError<Row, Arg> extends Error {
  req: ExecuteRequest<Row, Arg>
  connectionId: string

  constructor(args: { message: string; req: ExecuteRequest<Row, Arg>; connectionId: string; cause: Error }) {
    super(args.message, { cause: args.cause })
    this.req = args.req
    this.connectionId = args.connectionId
  }
}

export type ExecuteResult<Row, Arg> = Result<ExecuteSuccess<Row>, ExecuteError<Row, Arg>>

export type Executor<Arg> = {
  execute<Row>(req: ExecuteRequest<Row, Arg>): Promise<ExecuteSuccess<Row>>
}
