import type { Executor } from "../../spi/Executor"
import type { QueryFlowInput, QueryRunOptions, QueryRunner } from "../../spi/QueryRunner"
import type { Connection } from "../../domain/Connection"
import { aborter } from "../../domain/defer"
import { preserveErrorStack } from "../../domain/errors"
import { createId } from "../../domain/Id"
import {
  EpochMillis,
  type FlowEntry,
  type LogStore,
  type QueryExecution,
  type QueryFlow,
  type Session,
} from "../../domain/Log"
import { Result } from "../../domain/Result"
import { RowHandle } from "../../domain/RowStore"
import type { Paginated, SQL } from "../../domain/SQL"

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
  readonly flow: QueryFlow | undefined

  constructor(
    public readonly session: Session,
    public readonly connection: Connection<Config>,
    public readonly executor: Executor,
    private readonly logger: LogStore,
    options: {
      abortControllers?: Set<AbortController>
      flow?: QueryFlow
    } = {},
  ) {
    this.flow = options.flow
    this.#abortControllers = options.abortControllers ?? new Set<AbortController>()
  }

  #abortControllers: Set<AbortController>

  withFlow(flow: QueryFlow): QueryRunnerImpl<Config> {
    return new QueryRunnerImpl(this.session, this.connection, this.executor, this.logger, {
      abortControllers: this.#abortControllers,
      flow,
    })
  }

  async openFlow(input: QueryFlowInput): Promise<QueryFlow> {
    const flow: QueryFlow = {
      id: input.id ?? createId(),
      initiator: input.initiator,
      name: input.name,
      parentFlowId: input.parentFlowId,
    }
    await this.logger.upsert({
      connectionId: this.connection.id,
      createdAt: EpochMillis.now(),
      id: flow.id,
      initiator: flow.initiator,
      name: flow.name,
      parentFlowId: flow.parentFlowId,
      sessionId: this.session.id,
      type: "flow",
    } satisfies FlowEntry)
    return flow
  }

  async closeFlow(
    flow: QueryFlow,
    patch: {
      cancelled?: boolean
    } = {},
  ): Promise<void> {
    await this.logger.update(
      { id: flow.id, type: "flow" },
      {
        cancelled: patch.cancelled,
        endedAt: EpochMillis.now(),
      },
    )
  }

  async query<Row>(sql: SQL<Row>, options: QueryRunOptions = {}): Promise<Row[]> {
    const execution = await this.execute(sql, options)
    return execution.rows
  }

  async execute<Row>(sql: SQL<Row>, options: QueryRunOptions = {}): Promise<QueryExecution<Row>> {
    const { abortSignal, cleanup } = this.#createAbortHandle(options.abortSignal)
    abortSignal.throwIfAborted()
    const parentFlowId = options.parentFlowId ?? this.flow?.id
    const initiator = options.initiator ?? this.flow?.initiator ?? "user"

    const executionHandle = new RowHandle<QueryExecution<Row>>(this.logger, {
      id: options.executionId ?? createId(),
      type: "queryExecution",
    })
    const execution = await executionHandle.set({
      connectionId: this.connection.id,
      createdAt: EpochMillis.now(),
      sensitive: false,
      sessionId: this.session.id,
      savedQueryId: options.savedQueryId,
      initiator,
      sql: {
        source: sql.toSource(),
        args: sql.getArgs() as any[],
      },
      parentFlowId,
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
    options: QueryRunOptions = {},
  ): AsyncGenerator<Row[], Params> {
    const { abortSignal, cleanup } = this.#createAbortHandle(options.abortSignal)
    abortSignal.throwIfAborted()
    const flow = await this.openFlow({
      initiator: options.initiator ?? this.flow?.initiator ?? "user",
      name: "iterate",
      parentFlowId: options.parentFlowId ?? this.flow?.id,
    })
    const flowRunner = this.withFlow(flow)

    let cancelled = false
    using _ = aborter(abortSignal, () => {
      cancelled = true
    })

    try {
      while (true) {
        const rows = await flowRunner.query(paginated.query(params), {
          abortSignal,
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
      await this.closeFlow(flow, { cancelled })
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
