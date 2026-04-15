import { describe, expect, test } from "bun:test"
import * as publicApi from "../src/index"
import { BunSqlAdapter } from "../src/lib/adapters/BunSqlAdapter"
import { PostgresAdapter, postgres, postgresqlProtocolResolver } from "../src/lib/adapters/postgres"
import { SqlVisor } from "../src/lib/SqlVisor"

describe("public API", () => {
  test("re-exports the main entrypoints", () => {
    expect(publicApi.BunSqlAdapter).toBe(BunSqlAdapter)
    expect(publicApi.PostgresAdapter).toBe(PostgresAdapter)
    expect(publicApi.SqlVisor).toBe(SqlVisor)
    expect(publicApi.postgres).toBe(postgres)
    expect(publicApi.postgresqlProtocolResolver).toBe(postgresqlProtocolResolver)
    expect(publicApi.pendingQueryState().status).toBe("pending")
    expect(publicApi.queryStateOrPending(undefined, "fallback").data).toBe("fallback")
    expect(publicApi.rawSQL("select 1").toSource()).toBe("select 1")
    expect(publicApi.sql`select ${1}`.toSource()).toBe("select $1")
  })
})
