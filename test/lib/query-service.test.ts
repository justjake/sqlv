import { describe, expect, test } from "bun:test"
import { createSession } from "../../src/lib/createLocalPersistence"
import { type Executor } from "../../src/lib/interface/Executor"
import { QueryRunnerImpl } from "../../src/lib/QueryRunnerImpl"
import { EpochMillis, type FlowLogEntry, type LogEntry, type QueryExecution } from "../../src/lib/types/Log"
import { rowDispatcher } from "../../src/lib/types/RowStore"
import { Paginated, sql, unsafeRawSQL } from "../../src/lib/types/SQL"
import { makeConnection } from "../support"

function createMemoryLogStore() {
  const rows = new Map<string, LogEntry>()
  const keyFor = (row: Pick<LogEntry, "id" | "type">) => `${row.id}:${row.type}`

  return {
    list: () => Array.from(rows.values()),
    store: rowDispatcher<LogEntry>(async <T2 extends LogEntry>(action: any) => {
      switch (action.type) {
        case "query":
          return Array.from(rows.values()) as T2[]
        case "get":
          return rows.get(keyFor(action.ref)) as T2 | undefined
        case "insert":
        case "upsert":
          rows.set(keyFor(action.row), action.row)
          return action.row
        case "update": {
          const current = rows.get(keyFor(action.ref))
          if (!current) {
            return undefined
          }
          rows.set(keyFor(action.ref), {
            ...current,
            ...action.patch,
          } as LogEntry)
          return undefined
        }
        case "delete":
          rows.delete(keyFor(action.ref))
          return undefined
      }
    }),
  }
}

describe("QueryRunnerImpl", () => {
  test("records query executions for successful queries", async () => {
    const log = createMemoryLogStore()
    const calls: Array<{ args: unknown[]; source: string }> = []
    const executor: Executor = {
      async execute(request) {
        calls.push({
          args: request.sql.getArgs(),
          source: request.sql.toSource(),
        })
        return {
          rows: [{ value: 1 }] as any[],
        }
      },
    }

    const service = new QueryRunnerImpl(
      createSession("query"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      executor,
      log.store,
    )

    await expect(service.query(sql<{ value: number }>`select ${1}`)).resolves.toEqual([{ value: 1 }])

    const entries = log.list()
    const execution = entries.find(
      (entry): entry is QueryExecution<{ value: number }> => entry.type === "queryExecution",
    )

    expect(calls).toEqual([
      {
        args: [1],
        source: "select $1",
      },
    ])
    expect(execution).toMatchObject({
      connectionId: "conn-1",
      rowCount: 1,
      rows: [{ value: 1 }],
      sessionId: service.session.id,
      status: "success",
      sql: {
        args: [1],
        source: "select $1",
      },
      type: "queryExecution",
    })
  })

  test("records cancelled query executions", async () => {
    const log = createMemoryLogStore()
    const executor: Executor = {
      async execute() {
        const error = new Error("stopped")
        error.name = "AbortError"
        throw error
      },
    }

    const service = new QueryRunnerImpl(
      createSession("abort"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      executor,
      log.store,
    )

    await expect(service.query(unsafeRawSQL("cancel"))).rejects.toThrow("stopped")

    const execution = log.list().find((entry): entry is QueryExecution => entry.type === "queryExecution")
    expect(execution?.error).toBe("stopped")
    expect(execution).toMatchObject({
      rowCount: 0,
      status: "cancelled",
      type: "queryExecution",
    })
  })

  test("preserves original stacks for failed executions", async () => {
    const log = createMemoryLogStore()
    const cause = new Error("boom")
    cause.name = "DatabaseError"
    cause.stack = "DatabaseError: boom\n    at original (query-service.test.ts:1:1)"

    const service = new QueryRunnerImpl(
      createSession("failure"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      {
        async execute() {
          throw cause
        },
      },
      log.store,
    )

    let thrown: unknown
    try {
      await service.query(unsafeRawSQL("select boom"))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).toMatchObject({
      message: "boom",
      name: "DatabaseError",
      stack: cause.stack,
    })

    const execution = log.list().find((entry): entry is QueryExecution => entry.type === "queryExecution")
    expect(execution).toMatchObject({
      error: "boom",
      errorStack: cause.stack,
      status: "error",
      type: "queryExecution",
    })
  })

  test("iterates through paginated results and finalizes the flow log", async () => {
    const log = createMemoryLogStore()
    const executor: Executor = {
      async execute(request) {
        const [cursor, limit] = request.sql.getArgs() as [number, number]
        const rows = cursor === 0 ? [{ id: 1 }, { id: 2 }] : cursor === 2 && limit === 2 ? [{ id: 3 }] : []

        return { rows: rows as any[] }
      },
    }

    const service = new QueryRunnerImpl(
      createSession("iterate"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      executor,
      log.store,
    )

    const paginated = new Paginated(
      (params: { cursor: { id: number }; limit: number }) =>
        sql<{ id: number }>`select ${params.cursor.id}, ${params.limit}`,
      (row: { id: number }) => ({ id: row.id }),
    )

    const iterator = service.iterate(paginated, {
      cursor: { id: 0 },
      limit: 2,
    })

    expect(await iterator.next()).toEqual({
      done: false,
      value: [{ id: 1 }, { id: 2 }],
    })
    expect(await iterator.next()).toEqual({
      done: false,
      value: [{ id: 3 }],
    })
    expect(await iterator.next()).toEqual({
      done: true,
      value: {
        cursor: { id: 2 },
        limit: 2,
      },
    })

    const flow = log.list().find((entry): entry is FlowLogEntry => entry.type === "flow")
    expect(flow).toMatchObject({
      cancelled: false,
      connectionId: "conn-1",
      sessionId: service.session.id,
      type: "flow",
    })
    expect(flow?.endedAt).toBeGreaterThanOrEqual(EpochMillis(0))
  })

  test("marks flows as cancelled when the service is aborted", async () => {
    const log = createMemoryLogStore()
    const executor: Executor = {
      async execute(request) {
        request.abortSignal?.throwIfAborted()
        return {
          rows: [{ id: 1 }, { id: 2 }] as any[],
        }
      },
    }

    const service = new QueryRunnerImpl(
      createSession("cancel"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      executor,
      log.store,
    )
    const paginated = new Paginated(
      (params: { cursor: { id: number }; limit: number }) =>
        sql<{ id: number }>`select ${params.cursor.id}, ${params.limit}`,
      (row: { id: number }) => ({ id: row.id }),
    )

    const iterator = service.iterate(paginated, {
      cursor: { id: 0 },
      limit: 2,
    })
    expect((await iterator.next()).value).toEqual([{ id: 1 }, { id: 2 }])

    service.cancelAll()

    await expect(iterator.next()).rejects.toThrow()

    const flow = log.list().find((entry): entry is FlowLogEntry => entry.type === "flow")
    expect(flow).toMatchObject({
      cancelled: true,
      type: "flow",
    })
  })

  test("uses caller-provided execution ids", async () => {
    const service = new QueryRunnerImpl(
      createSession("id"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      {
        async execute() {
          return { rows: [] as never[] }
        },
      },
      createMemoryLogStore().store,
    )

    const execution = await service.execute(unsafeRawSQL("select 1"), {
      executionId: "query-123",
    })

    expect(execution.id).toBe("query-123")
  })

  test("can run new queries after cancelling in-flight work", async () => {
    const service = new QueryRunnerImpl(
      createSession("reset"),
      makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      }),
      {
        async execute(request) {
          if (request.sql.toSource() === "wait") {
            return await new Promise<{ rows: never[] }>((_resolve, reject) => {
              const onAbort = () => {
                const error = new Error("stopped")
                error.name = "AbortError"
                reject(error)
              }

              if (request.abortSignal?.aborted) {
                onAbort()
                return
              }

              request.abortSignal?.addEventListener("abort", onAbort, { once: true })
            })
          }

          request.abortSignal?.throwIfAborted()
          return { rows: [{ value: 1 }] as any[] }
        },
      },
      createMemoryLogStore().store,
    )

    const pending = service.query(unsafeRawSQL("wait"))
    service.cancelAll()

    await expect(pending).rejects.toThrow("stopped")
    await expect(service.query(unsafeRawSQL("select 1"))).resolves.toEqual([{ value: 1 }])
  })
})
