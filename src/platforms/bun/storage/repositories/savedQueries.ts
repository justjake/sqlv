import { eq } from "drizzle-orm"

import type { MutableRowStore, RowRef } from "#domain/RowStore"
import type { SavedQuery } from "#domain/SavedQuery"

import type { StorageDatabase } from "../boot"
import { savedQueries } from "../schema/savedQueries"

function toDomain(row: typeof savedQueries.$inferSelect): SavedQuery {
  return {
    id: row.id,
    type: "savedQuery",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined,
    name: row.name,
    text: row.text,
    protocol: row.protocol ?? undefined,
  }
}

function toInsert(row: SavedQuery): typeof savedQueries.$inferInsert {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
    name: row.name,
    text: row.text,
    protocol: row.protocol ?? null,
  }
}

function toUpdate(row: SavedQuery) {
  return {
    name: row.name,
    protocol: row.protocol ?? null,
    text: row.text,
    updatedAt: row.updatedAt ?? null,
  } satisfies Omit<typeof savedQueries.$inferInsert, "createdAt" | "id">
}

export function createSavedQueriesStore(db: StorageDatabase): MutableRowStore<SavedQuery> {
  const getSavedQuery = async (ref: RowRef<SavedQuery>) => {
    if (ref.type !== "savedQuery") {
      return undefined
    }

    const [row] = await db.select().from(savedQueries).where(eq(savedQueries.id, ref.id)).limit(1)
    return row ? toDomain(row) : undefined
  }

  return {
    async list() {
      return (await db.select().from(savedQueries)).map(toDomain)
    },

    async get(ref: RowRef<SavedQuery>) {
      return getSavedQuery(ref)
    },

    async insert(row) {
      await db.insert(savedQueries).values(toInsert(row))
      return row
    },

    async upsert(row) {
      await db
        .insert(savedQueries)
        .values(toInsert(row))
        .onConflictDoUpdate({
          set: toUpdate(row),
          target: savedQueries.id,
        })
      return row
    },

    async update(ref, patch) {
      const current = await getSavedQuery(ref)
      if (!current) {
        return
      }

      const next = {
        ...current,
        ...patch,
      } satisfies SavedQuery

      await db.update(savedQueries).set(toUpdate(next)).where(eq(savedQueries.id, ref.id))
    },

    async delete(ref) {
      if (ref.type !== "savedQuery") {
        return
      }

      await db.delete(savedQueries).where(eq(savedQueries.id, ref.id))
    },
  }
}
