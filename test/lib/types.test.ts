import { describe, expect, test } from "bun:test"

import { createId } from "../../src/domain/Id"
import { EpochMillis } from "../../src/domain/Log"
import { OrderString } from "../../src/domain/Order"
import { pendingQueryState, queryStateOrPending } from "../../src/domain/QueryState"
import { Err, Ok, Result, UnwrapError } from "../../src/domain/Result"
import { RowHandle, rowDispatcher, type BaseRow } from "../../src/domain/RowStore"
import { Argument, Identifier, Paginated, ident, namedArg, sql, unsafeRawSQL } from "../../src/domain/SQL"
import { aborter, asyncDefer, cleanup, defer } from "../../src/domain/defer"
import {
  mustBeArray,
  mustBeDefined,
  mustBeOptionalSingle,
  mustBeSingle,
  unreachable,
} from "../../src/domain/unreachable"
import type { ConnectionSpec } from "../../src/spi/Adapter"

type TestRow = BaseRow & {
  count?: number
  name: string
}

describe("type utilities", () => {
  test("creates branded primitive helpers", () => {
    expect(createId()).toMatch(/^[0-9a-f-]{36}$/i)
    expect(OrderString("after") as string).toBe("after")
    expect(EpochMillis(42) as number).toBe(42)
    expect(EpochMillis.now()).toBeGreaterThan(0)
  })

  test("renders and collects SQL fragments", () => {
    const table = ident('users"', {
      connection: "local",
      database: "main",
      schema: "public",
    })
    const idArg = namedArg("id", 7)
    const query = sql<unknown, string | number>`
      select * from ${table}
      where id = ${idArg} and name = ${"Ada"} and ${unsafeRawSQL("1 = 1")}
    `

    expect(query.toSource()).toContain('"local"."main"."public"."users"""')
    expect(query.toSource()).toContain("$1")
    expect(query.toSource()).toContain("$2")
    expect(query.toString()).toContain("$id")
    expect(query.getBindings()).toHaveLength(2)
    expect(query.getArgs()).toEqual([7, "Ada"])

    const named = query.named("find-user").namespaced({ schema: "public" })
    expect(named.queryName).toBe("find-user")
    expect(named.queryNamespace).toEqual({ schema: "public" })
    expect(named.clone()).not.toBe(named)

    expect(new Argument("Ada", "name").toString()).toBe("Argument(name => Ada)")
    expect(new Identifier("users", "public", "main", "local").toString()).toBe(
      "Identifier(@local.db(main).schema(public).users)",
    )
  })

  test("stores pagination callbacks", () => {
    const paginated = new Paginated(
      (params: { cursor: { id: number }; limit: number }) => unsafeRawSQL<{ id: number }>(`page-${params.limit}`),
      (row: { id: number }) => ({ id: row.id }),
      (params: { cursor: { id: number }; limit: number }) => unsafeRawSQL<{ count: number }>(`count-${params.limit}`),
    )

    expect(paginated.query({ cursor: { id: 0 }, limit: 5 }).toSource()).toBe("page-5")
    expect(paginated.cursor({ id: 9 })).toEqual({ id: 9 })
    expect(paginated.count?.({ cursor: { id: 0 }, limit: 5 }).toSource()).toBe("count-5")
  })

  test("allows optional config spec URI hooks", () => {
    const spec: ConnectionSpec<{ path: string }> = {
      label: "Filesystem",
      fields: [],
      createConfig() {
        return { path: ":memory:" }
      },
      fromURI(uri) {
        return { path: uri }
      },
      toURI(config) {
        return config.path
      },
    }

    const minimalSpec: ConnectionSpec<{ path: string }> = {
      label: "Minimal",
      fields: [],
      createConfig() {
        return { path: "app.db" }
      },
    }

    expect(spec.fromURI?.("file:///tmp/app.db")).toEqual({ path: "file:///tmp/app.db" })
    expect(spec.toURI?.({ path: "file:///tmp/app.db" })).toBe("file:///tmp/app.db")
    expect(minimalSpec.fromURI).toBeUndefined()
    expect(minimalSpec.toURI).toBeUndefined()
  })

  test("supports Result combinators and unwrap helpers", async () => {
    const tapped: Array<string | number> = []

    const ok = Result.ok(2)
    expect(ok.map((value) => value + 1).unwrap()).toBe(3)
    expect(ok.andThen((value) => Result.ok(value * 2)).unwrap()).toBe(4)
    expect(ok.tap((value) => tapped.push(value))).toBe(ok)
    expect(ok.or(10).unwrap()).toBe(2)
    expect(ok.unwrapOr(10)).toBe(2)
    expect(ok.unwrapOrElse(() => 10)).toBe(2)
    expect(ok.match({ ok: (value) => `ok:${value}`, err: () => "err" })).toBe("ok:2")
    expect(ok.toString()).toBe("Ok(2)")

    const err = Result.err("boom") as any
    expect(err.mapErr((error: string) => `${error}!`).unwrapErr()).toBe("boom!")
    expect(err.tapErr((error: string) => tapped.push(error))).toBe(err)
    expect(err.or(5).unwrap()).toBe(5)
    expect(err.orElse((error: string) => Result.ok(error.length)).unwrap()).toBe(4)
    expect(tapped).toEqual([2, "boom"])

    expect(Result.isResult(ok)).toBe(true)
    expect(Result.isResult({})).toBe(false)
    expect(Result.all([Result.ok(1), Result.ok(2)]).unwrap()).toEqual([1, 2])
    expect(Result.all([Result.ok(1), Result.err("nope")]).unwrapErr()).toBe("nope")
    expect(Result.toError("bad").message).toContain("Non-error throw: bad")

    const syncThrown = Result.try(() => {
      throw "sync"
    })
    expect(syncThrown.err()).toBe(true)
    expect(syncThrown.unwrapErr()).toBeInstanceOf(Error)

    const asyncThrown = await Result.try(async () => {
      throw new Error("async")
    })
    expect(asyncThrown.unwrapErr().message).toBe("async")

    expect(() => Result.err("x").expect("explode")).toThrow(UnwrapError)
    expect(() => Result.ok(1).expectErr("explode")).toThrow(UnwrapError)
    expect(new Ok("value").ok()).toBe(true)
    expect(new Err("value").err()).toBe(true)
  })

  test("dispatches row operations and row handles", async () => {
    const rows = new Map<string, TestRow>()
    const keyFor = (row: Pick<TestRow, "id" | "type">) => `${row.id}:${row.type}`

    const store = rowDispatcher<TestRow>(async <T2 extends TestRow>(action: any) => {
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
          } as TestRow)
          return undefined
        }
        case "delete":
          rows.delete(keyFor(action.ref))
          return undefined
      }
    })

    const createdAt = EpochMillis(1)
    const firstRow: TestRow = {
      id: "1",
      type: "test",
      createdAt,
      name: "first",
    }

    expect(await store.insert(firstRow)).toEqual(firstRow)
    expect(await store.query(() => unsafeRawSQL<TestRow>("select"))).toEqual([firstRow])
    expect(await store.get({ id: "1", type: "test" })).toEqual(firstRow)

    const handle = new RowHandle(store, {
      id: "2",
      type: "test",
    })

    const second = await handle.set({
      createdAt,
      name: "second",
    })
    expect(second.updatedAt).toBeDefined()

    await handle.update({ count: 2 })
    expect(await handle.get()).toMatchObject({
      count: 2,
      id: "2",
      name: "second",
    })

    await store.delete({ id: "1", type: "test" })
    expect(await store.get({ id: "1", type: "test" })).toBeUndefined()
  })

  test("creates pending query states", () => {
    const pending = pendingQueryState<string>()
    expect(pending.status).toBe("pending")
    expect(pending.fetchStatus).toBe("idle")

    const withData = pendingQueryState("ready")
    expect(withData.status).toBe("success")
    expect(withData.data).toBe("ready")

    expect(queryStateOrPending(withData)).toBe(withData)
    expect(queryStateOrPending(undefined, "fallback").data).toBe("fallback")
  })

  test("registers deferred cleanup callbacks", async () => {
    const calls: string[] = []

    const deferred = defer(() => {
      calls.push("defer")
    })
    deferred[Symbol.dispose]()

    const cleaned = cleanup(
      () => "value",
      (value) => {
        calls.push(`cleanup:${value}`)
      },
    )
    cleaned[Symbol.dispose]()

    const asyncCleaned = asyncDefer(async () => {
      calls.push("async")
    })
    await asyncCleaned[Symbol.asyncDispose]()

    const controller = new AbortController()
    const aborted = aborter(controller.signal, () => {
      calls.push("abort")
    })
    controller.abort()
    aborted[Symbol.dispose]()

    const removedController = new AbortController()
    const removed = aborter(removedController.signal, () => {
      calls.push("should-not-run")
    })
    removed[Symbol.dispose]()
    removedController.abort()

    expect(calls).toEqual(["defer", "cleanup:value", "async", "abort"])
  })

  test("guards impossible branches and shape assumptions", () => {
    expect(mustBeDefined("value")).toBe("value")
    expect(mustBeSingle(["value"])).toBe("value")
    expect(mustBeOptionalSingle([] as string[])).toBeUndefined()
    expect(mustBeOptionalSingle(["value"])).toBe("value")
    expect(mustBeArray("value")).toEqual(["value"])
    expect(mustBeArray(["value"])).toEqual(["value"])

    expect(() => mustBeDefined(undefined)).toThrow("Expected value to be defined")
    expect(() => mustBeSingle(["one", "two"])).toThrow("Expected value to be a single item")
    expect(() => mustBeOptionalSingle(["one", "two"])).toThrow("Expected value to be zero or one item")
    expect(() => unreachable("boom" as never)).toThrow('Expected case to never occur: "boom"')
  })
})
