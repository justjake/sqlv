import { eq } from "drizzle-orm"

import type { FlowEntry, LogEntry, LogStore, QueryExecution, Session } from "#domain/Log"
import type { RowRef } from "#domain/RowStore"

import type { StorageDatabase } from "../boot"
import { flows } from "../schema/flows"
import { queryExecutions, type QueryExecutionRowData } from "../schema/queryExecutions"
import { sessions } from "../schema/sessions"

function toSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    type: "session",
    app: row.app,
    createdAt: row.createdAt,
  }
}

function toFlow(row: typeof flows.$inferSelect): FlowEntry {
  return {
    id: row.id,
    type: "flow",
    sessionId: row.sessionId,
    connectionId: row.connectionId,
    name: row.name,
    initiator: row.initiator,
    parentFlowId: row.parentFlowId ?? undefined,
    createdAt: row.createdAt,
    endedAt: row.endedAt ?? undefined,
    cancelled: row.cancelled ?? undefined,
  }
}

function toQueryExecution(row: typeof queryExecutions.$inferSelect): QueryExecution {
  return {
    id: row.id,
    type: "queryExecution",
    sessionId: row.sessionId,
    connectionId: row.connectionId,
    savedQueryId: row.savedQueryId ?? undefined,
    initiator: row.initiator,
    parentFlowId: row.parentFlowId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    database: row.database ?? undefined,
    schema: row.schema ?? undefined,
    table: row.table ?? undefined,
    sql: {
      source: row.sqlSource,
      args: row.sqlArgs,
    },
    sensitive: row.sensitive,
    status: row.status,
    rowCount: row.rowCount,
    insertCount: row.insertCount ?? undefined,
    error: row.error ?? undefined,
    errorStack: row.errorStack ?? undefined,
    rows: row.rows,
  }
}

function toSessionInsert(row: Session): typeof sessions.$inferInsert {
  return {
    id: row.id,
    app: row.app,
    createdAt: row.createdAt,
  }
}

function toFlowInsert(row: FlowEntry): typeof flows.$inferInsert {
  return {
    id: row.id,
    sessionId: row.sessionId,
    connectionId: row.connectionId,
    name: row.name,
    initiator: row.initiator,
    parentFlowId: row.parentFlowId ?? null,
    createdAt: row.createdAt,
    endedAt: row.endedAt ?? null,
    cancelled: row.cancelled ?? null,
  }
}

function toFlowUpdate(row: FlowEntry) {
  return {
    cancelled: row.cancelled ?? null,
    connectionId: row.connectionId,
    endedAt: row.endedAt ?? null,
    initiator: row.initiator,
    name: row.name,
    parentFlowId: row.parentFlowId ?? null,
    sessionId: row.sessionId,
  } satisfies Omit<typeof flows.$inferInsert, "createdAt" | "id">
}

function toQueryExecutionInsert(row: QueryExecution<any>): typeof queryExecutions.$inferInsert {
  return {
    id: row.id,
    sessionId: row.sessionId,
    connectionId: row.connectionId,
    savedQueryId: row.savedQueryId ?? null,
    initiator: row.initiator,
    parentFlowId: row.parentFlowId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    database: row.database ?? null,
    schema: row.schema ?? null,
    table: row.table ?? null,
    sqlSource: row.sql.source,
    sqlArgs: row.sql.args,
    sensitive: row.sensitive,
    status: row.status,
    rowCount: row.rowCount,
    insertCount: row.insertCount ?? null,
    error: row.error ?? null,
    errorStack: row.errorStack ?? null,
    rows: row.rows as QueryExecutionRowData[],
  }
}

function toQueryExecutionUpdate(row: QueryExecution<any>) {
  return {
    connectionId: row.connectionId,
    database: row.database ?? null,
    error: row.error ?? null,
    errorStack: row.errorStack ?? null,
    finishedAt: row.finishedAt ?? null,
    initiator: row.initiator,
    insertCount: row.insertCount ?? null,
    parentFlowId: row.parentFlowId ?? null,
    rowCount: row.rowCount,
    rows: row.rows as QueryExecutionRowData[],
    savedQueryId: row.savedQueryId ?? null,
    schema: row.schema ?? null,
    sensitive: row.sensitive,
    sessionId: row.sessionId,
    sqlArgs: row.sql.args,
    sqlSource: row.sql.source,
    status: row.status,
    table: row.table ?? null,
    updatedAt: row.updatedAt ?? null,
  } satisfies Omit<typeof queryExecutions.$inferInsert, "createdAt" | "id">
}

function sortEntries(entries: LogEntry[]): LogEntry[] {
  return entries.toSorted((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

async function getFlow(db: StorageDatabase, id: string): Promise<FlowEntry | undefined> {
  const [row] = await db.select().from(flows).where(eq(flows.id, id)).limit(1)
  return row ? toFlow(row) : undefined
}

async function getQueryExecution(db: StorageDatabase, id: string): Promise<QueryExecution | undefined> {
  const [row] = await db.select().from(queryExecutions).where(eq(queryExecutions.id, id)).limit(1)
  return row ? toQueryExecution(row) : undefined
}

async function getSession(db: StorageDatabase, id: string): Promise<Session | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
  return row ? toSession(row) : undefined
}

async function upsertEntry(db: StorageDatabase, row: LogEntry): Promise<void> {
  switch (row.type) {
    case "session":
      await db
        .insert(sessions)
        .values(toSessionInsert(row))
        .onConflictDoUpdate({
          set: {
            app: row.app,
          },
          target: sessions.id,
        })
      return

    case "flow":
      await db
        .insert(flows)
        .values(toFlowInsert(row))
        .onConflictDoUpdate({
          set: toFlowUpdate(row),
          target: flows.id,
        })
      return

    case "queryExecution":
      await db
        .insert(queryExecutions)
        .values(toQueryExecutionInsert(row))
        .onConflictDoUpdate({
          set: toQueryExecutionUpdate(row),
          target: queryExecutions.id,
        })
      return

    case "connect":
      throw new Error("Connect log entries are not persisted by the Drizzle storage backend.")
  }
}

export function createLogStore(db: StorageDatabase): LogStore {
  const getEntry = async (ref: RowRef<LogEntry>) => {
    switch (ref.type) {
      case "session":
        return getSession(db, ref.id)
      case "flow":
        return getFlow(db, ref.id)
      case "queryExecution":
        return getQueryExecution(db, ref.id)
      case "connect":
        return undefined
    }
  }

  return {
    async list() {
      const [sessionRows, flowRows, executionRows] = await Promise.all([
        db.select().from(sessions),
        db.select().from(flows),
        db.select().from(queryExecutions),
      ])

      return sortEntries([
        ...sessionRows.map(toSession),
        ...flowRows.map(toFlow),
        ...executionRows.map(toQueryExecution),
      ])
    },

    async get(ref: RowRef<LogEntry>) {
      return getEntry(ref)
    },

    async insert(row) {
      await upsertEntry(db, row)
      return row
    },

    async upsert(row) {
      await upsertEntry(db, row)
      return row
    },

    async update(ref, patch) {
      const current = await getEntry(ref)
      if (!current) {
        return
      }

      await upsertEntry(db, {
        ...current,
        ...patch,
      } as LogEntry)
    },

    async delete(ref) {
      switch (ref.type) {
        case "session":
          await db.delete(sessions).where(eq(sessions.id, ref.id))
          return
        case "flow":
          await db.delete(flows).where(eq(flows.id, ref.id))
          return
        case "queryExecution":
          await db.delete(queryExecutions).where(eq(queryExecutions.id, ref.id))
          return
        case "connect":
          return
      }
    },
  }
}
