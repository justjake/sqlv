import { eq } from "drizzle-orm"

import type { Connection } from "#domain/Connection"
import type { MutableRowStore, RowRef } from "#domain/RowStore"

import type { StorageDatabase } from "../boot"
import { connections } from "../schema/connections"

function toDomain(row: typeof connections.$inferSelect): Connection<any> {
  return {
    id: row.id,
    type: "connection",
    name: row.name,
    createdAt: row.createdAt,
    order: row.order,
    protocol: row.protocol,
    config: row.config,
  }
}

function toInsert(row: Connection<any>): typeof connections.$inferInsert {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    config: row.config,
    order: row.order,
    createdAt: row.createdAt,
  }
}

function toUpdate(row: Connection<any>) {
  return {
    config: row.config,
    name: row.name,
    order: row.order,
    protocol: row.protocol,
  } satisfies Omit<typeof connections.$inferInsert, "createdAt" | "id">
}

export function createConnectionsStore(db: StorageDatabase): MutableRowStore<Connection<any>> {
  const getConnection = async (ref: RowRef<Connection<any>>) => {
    if (ref.type !== "connection") {
      return undefined
    }

    const [row] = await db.select().from(connections).where(eq(connections.id, ref.id)).limit(1)
    return row ? toDomain(row) : undefined
  }

  return {
    async list() {
      return (await db.select().from(connections)).map(toDomain)
    },

    async get(ref: RowRef<Connection<any>>) {
      return getConnection(ref)
    },

    async insert(row) {
      await db.insert(connections).values(toInsert(row))
      return row
    },

    async upsert(row) {
      await db
        .insert(connections)
        .values(toInsert(row))
        .onConflictDoUpdate({
          set: toUpdate(row),
          target: connections.id,
        })
      return row
    },

    async update(ref, patch) {
      const current = await getConnection(ref)
      if (!current) {
        return
      }

      const next = {
        ...current,
        ...patch,
      } satisfies Connection<any>

      await db.update(connections).set(toUpdate(next)).where(eq(connections.id, ref.id))
    },

    async delete(ref) {
      if (ref.type !== "connection") {
        return
      }

      await db.delete(connections).where(eq(connections.id, ref.id))
    },
  }
}
