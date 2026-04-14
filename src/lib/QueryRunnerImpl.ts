import type { Executor } from "./interface/Executor"
import type { Connection } from "./types/Connection"
import { aborter } from "./types/defer"
import { createId } from "./types/Id"
import { EpochMillis, type FlowEntry, type LogStore, type QueryExecution, type Session } from "./types/Log"
import type { QueryRunner } from "./types/QueryRunner"
import { Result } from "./types/Result"
import { preserveErrorStack } from "./types/errors"
import { RowHandle } from "./types/RowStore"
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

type ExecuteOptions = {
  abortSignal?: AbortSignal
  executionId?: string
  flowId?: string
}

export class QueryRunnerImpl<Config> implements QueryRunner<Config> {
  constructor(
    public readonly session: Session,
    public readonly connection: Connection<Config>,
    private readonly executor: Executor,
    private readonly logger: LogStore,
  ) {}

  #abortControllers = new Set<AbortController>()

  async query<Row>(sql: SQL<Row>, options: ExecuteOptions = {}): Promise<Row[]> {
    const execution = await this.execute(sql, options)
    return execution.rows
  }

  async execute<Row>(sql: SQL<Row>, options: ExecuteOptions = {}): Promise<QueryExecution<Row>> {
    const { abortSignal, cleanup } = this.#createAbortHandle(options.abortSignal)
    abortSignal.throwIfAborted()

    const executionHandle = new RowHandle<QueryExecution<Row>>(this.logger, {
      id: options.executionId ?? createId(),
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
      flowId: options.flowId,
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
    } finally {
      cleanup()
    }
  }

  async *iterate<Params extends { limit: number; cursor: object }, Row>(
    paginated: Paginated<Params, Row>,
    params: Params,
  ): AsyncGenerator<Row[], Params> {
    const { abortSignal, cleanup } = this.#createAbortHandle()
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
        const rows = await this.query(paginated.query(params), {
          abortSignal: flowRef.abortSignal,
          flowId: flowRef.id,
        })
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
      cleanup()
      await flowHandle.update({
        endedAt: EpochMillis.now(),
        cancelled,
      })
    }
  }

  cancelAll() {
    const controllers = Array.from(this.#abortControllers)
    for (const controller of controllers) {
      controller.abort()
    }
  }

  #createAbortHandle(externalAbortSignal?: AbortSignal) {
    const controller = new AbortController()
    this.#abortControllers.add(controller)

    const onAbort = () => {
      controller.abort(externalAbortSignal?.reason)
    }

    if (externalAbortSignal) {
      if (externalAbortSignal.aborted) {
        controller.abort(externalAbortSignal.reason)
      } else {
        externalAbortSignal.addEventListener("abort", onAbort, { once: true })
      }
    }

    return {
      abortSignal: controller.signal,
      cleanup: () => {
        if (externalAbortSignal) {
          externalAbortSignal.removeEventListener("abort", onAbort)
        }
        this.#abortControllers.delete(controller)
      },
    }
  }
}
