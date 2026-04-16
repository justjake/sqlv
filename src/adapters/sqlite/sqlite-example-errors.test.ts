import { describe, expect, test } from "bun:test"

import { BunSqlAdapter } from "./bun/BunSqliteAdapter"
import { createNoopLogStore } from "../../engine/runtime/createNoopLogStore"
import { createSession } from "../../platforms/bun/storage/createLocalStorage"
import { QueryRunnerImpl } from "../../engine/runtime/QueryRunnerImpl"
import { unsafeRawSQL } from "../../domain/SQL"
import { loadSqliteExampleErrorCases } from "./exampleErrors"
import { makeConnection } from "../../testSupport"

describe("sqlite example error fixtures", () => {
  for (const exampleCase of loadSqliteExampleErrorCases()) {
    test(exampleCase.id, async () => {
      const adapter = new BunSqlAdapter()
      const connection = makeConnection({
        config: {
          path: ":memory:",
        },
        protocol: "bunsqlite",
      })
      const executor = await adapter.connect(connection.config)
      const db = new QueryRunnerImpl(
        createSession(`fixture:${exampleCase.id}`),
        connection,
        executor,
        createNoopLogStore(),
      )

      await db.query(unsafeRawSQL("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"))

      const result = await adapter.explain(db, {
        abortSignal: new AbortController().signal,
        text: exampleCase.sql,
      })

      expect(result).toEqual({
        diagnostics: [
          {
            message: exampleCase.message,
            range: exampleCase.range,
            severity: "error",
          },
        ],
        status: "invalid",
      })
    })
  }
})
