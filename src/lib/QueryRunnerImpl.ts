import type { Executor } from "./interface/Executor"
import type { Connection } from "./types/Connection"
import { aborter } from "./types/defer"
import { createId } from "./types/Id"
import { EpochMillis, type FlowEntry, type LogStore, type QueryExecution, type Session } from "./types/Log"
import type { QueryRunner } from "./types/QueryRunner"
import { Result } from "./types/Result"
import { preserveErrorStack } from "./types/errors"
import { RowHandle, type RowRef } from "./types/RowStore"
import type { Paginated, SQL } from "./types/SQL"

export class QueryExecutionError<Row = object> extends Error {
  constructor(
    public readonly execution: QueryExecution<Row>,
    options?: {
      cause?: unknown
    },
  ) {
    super(execution.error ?? `Query ${execution.status}`, {
      cause: options?.cause,
    })
    this.name = options?.cause instanceof Error ? options.cause.name : "QueryExecutionError"
    if (options?.cause) {
      preserveErrorStack(this, options.cause)
    } else if (execution.errorStack) {
      this.stack = execution.errorStack
    }
  }
}

export class QueryRunnerImpl<Config> implements QueryRunner<Config> {
  constructor(
    public readonly session: Session,
    public readonly connection: Connection<Config>,
    private readonly executor: Executor,
    private readonly logger: LogStore,
  ) {}

  #abortController: AbortController | undefined
  get abortController() {
    this.#abortController ??= new AbortController()
    return this.#abortController
  }

  async query<Row>(sql: SQL<Row>, flow?: RowRef<FlowEntry> & { abortSignal: AbortSignal }): Promise<Row[]> {
    const execution = await this.execute(sql, flow)
    return execution.rows
  }

  async execute<Row>(
    sql: SQL<Row>,
    flow?: RowRef<FlowEntry> & { abortSignal: AbortSignal },
  ): Promise<QueryExecution<Row>> {
    const abortSignal = flow?.abortSignal ?? this.abortController.signal
    abortSignal.throwIfAborted()

    const executionHandle = new RowHandle<QueryExecution<Row>>(this.logger, {
      id: createId(),
      type: "queryExecution",
    })
    const execution = await executionHandle.set({
      connectionId: this.connection.id,
      createdAt: EpochMillis.now(),
      sensitive: false,
      sessionId: this.session.id,
      sql: {
        source: sql.toSource(),
        args: sql.getArgs() as any[],
      },
      flowId: flow?.id,
      rows: [],
      rowCount: 0,
      status: "pending",
    })

    try {
      const { rows } = await this.executor.execute({
        sql,
        abortSignal,
      })
      await executionHandle.update({
        finishedAt: EpochMillis.now(),
        rowCount: rows.length,
        rows,
        status: "success",
      })
      return (
        (await executionHandle.get()) ?? {
          ...execution,
          finishedAt: EpochMillis.now(),
          rowCount: rows.length,
          rows,
          status: "success",
        }
      )
    } catch (_error) {
      const error = Result.toError(_error)
      const status = error.name === "AbortError" ? "cancelled" : "error"
      await executionHandle.update({
        error: error.message,
        errorStack: error.stack,
        finishedAt: EpochMillis.now(),
        rowCount: 0,
        rows: [],
        status,
      })

      throw new QueryExecutionError(
        (await executionHandle.get()) ?? {
          ...execution,
          error: error.message,
          errorStack: error.stack,
          finishedAt: EpochMillis.now(),
          rowCount: 0,
          rows: [],
          status,
        },
        { cause: error },
      )
    }
  }

  async *iterate<Params extends { limit: number; cursor: object }, Row>(
    paginated: Paginated<Params, Row>,
    params: Params,
  ): AsyncGenerator<Row[], Params> {
    const abortSignal = this.abortController.signal
    abortSignal.throwIfAborted()

    const flowHandle = new RowHandle<FlowEntry>(this.logger, {
      id: createId(),
      type: "flow",
    })

    await flowHandle.set({
      connectionId: this.connection.id,
      sessionId: this.session.id,
      createdAt: EpochMillis.now(),
    })

    const flowRef = {
      ...flowHandle.ref,
      abortSignal,
    }

    let cancelled = false
    using _ = aborter(flowRef.abortSignal, () => {
      cancelled = true
    })

    try {
      while (true) {
        const rows = await this.query(paginated.query(params), flowRef)
        yield rows
        if (rows.length < params.limit) {
          break
        }
        const cursor = paginated.cursor(rows[rows.length - 1]!)
        params = {
          ...params,
          cursor,
        }
      }
      return params
    } finally {
      await flowHandle.update({
        endedAt: EpochMillis.now(),
        cancelled,
      })
    }
  }

  cancelAll() {
    this.#abortController?.abort()
    this.#abortController = undefined
  }
}
