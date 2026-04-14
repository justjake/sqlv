import { preserveErrorStack } from "../types/errors"
import type { Result } from "../types/Result"
import type { SQL } from "../types/SQL"

// TODO: we should remove pretty mich everything fancy from here, since probably
// shared tracking middleware can provide all the standard complexity.
//
// that way implementers have it very easy
export type ExecuteRequest<Row> = {
  // requestId: string
  abortSignal: AbortSignal | undefined
  sql: SQL<Row>
  // queryName?: string
  // sensitive?: boolean
  // record?: boolean
}

export type ExecuteSuccess<Row> = {
  rows: Row[]
}

export class ExecuteError<Row> extends Error {
  req: ExecuteRequest<Row>
  connectionId: string

  constructor(args: { message: string; req: ExecuteRequest<Row>; connectionId: string; cause: Error }) {
    super(args.message, { cause: args.cause })
    this.req = args.req
    this.connectionId = args.connectionId
    preserveErrorStack(this, args.cause)
  }
}

export type ExecuteResult<Row> = Result<ExecuteSuccess<Row>, ExecuteError<Row>>

export type Executor = {
  execute<Row>(req: ExecuteRequest<Row>): Promise<ExecuteSuccess<Row>>
}
