import type { Executor } from "./interface/Executor"
import type { Connection } from "./types/Connection"
import { aborter } from "./types/defer"
import { createId } from "./types/Id"
import { EpochMillis, type FlowEntry, type LogStore, type ResponseLogEntry, type SessionLogEntry } from "./types/Log"
import type { QueryService } from "./types/QueryService"
import { Result } from "./types/Result"
import { RowHandle, type RowRef } from "./types/RowStore"
import type { Paginated, SQL } from "./types/SQL"

export class QueryServiceImpl<Config, Args> implements QueryService<Config, Args> {
  constructor(
    public readonly session: SessionLogEntry,
    public readonly connection: Connection<Config>,
    private readonly executor: Executor<Args>,
    private readonly logger: LogStore,
  ) {}

  #abortController: AbortController | undefined
  get abortController() {
    if (!this.#abortController) {
      this.#abortController = new AbortController()
    }
    return this.#abortController
  }

  async query<Row>(sql: SQL<Row, Args>, flow?: RowRef<FlowEntry> & { abortSignal: AbortSignal }): Promise<Row[]> {
    const abortSignal = flow?.abortSignal ?? this.abortController.signal
    abortSignal.throwIfAborted()

    const req = await this.logger.insert({
      type: "req",
      connectionId: this.connection.id,
      createdAt: EpochMillis.now(),
      id: createId(),
      sensitive: false,
      sessionId: this.session.id,
      sql: {
        source: sql.toSource(),
        args: sql.getArgs() as any[],
      },
      flowId: flow?.id,
    })

    let result: Row[]
    const resHandle = new RowHandle<ResponseLogEntry>(this.logger, {
      id: createId(),
      type: "res",
    })

    try {
      const { rows } = await this.executor.execute({
        sql,
        abortSignal,
      })
      result = rows
    } catch (_error) {
      const error = Result.toError(_error)
      await resHandle.set({
        requestId: req.id,
        connectionId: req.connectionId,
        sessionId: req.sessionId,
        createdAt: EpochMillis.now(),
        rowCount: 0,
        rows: [],
        success: false,
        cancelled: error.name === "AbortError",
        error: String(error),
        flowId: flow?.id,
      })
      throw error
    }

    await resHandle.set({
      requestId: req.id,
      connectionId: req.connectionId,
      sessionId: req.sessionId,
      createdAt: EpochMillis.now(),
      rowCount: result.length,
      rows: result as any[],
      success: true,
      cancelled: false,
      flowId: flow?.id,
    })

    return result
  }

  async *iterate<Params extends { limit: number; cursor: object }, Row>(
    paginated: Paginated<Params, Row, Args>,
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
