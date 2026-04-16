import { eq } from "drizzle-orm"

import type { AnyAppStateRow, AppStateStore } from "#domain/AppState"
import type { RowRef } from "#domain/RowStore"

import type { StorageDatabase } from "../boot"
import { appState } from "../schema/appState"

function toDomain(row: typeof appState.$inferSelect): AnyAppStateRow {
  return {
    id: row.id,
    type: "appState",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined,
    value: row.value,
  }
}

function toInsert(row: AnyAppStateRow): typeof appState.$inferInsert {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
    value: row.value,
  }
}

function toUpdate(row: AnyAppStateRow) {
  return {
    updatedAt: row.updatedAt ?? null,
    value: row.value,
  } satisfies Omit<typeof appState.$inferInsert, "createdAt" | "id">
}

export function createAppStateStore(db: StorageDatabase): AppStateStore {
  const getAppState = async (ref: RowRef<AnyAppStateRow>) => {
    if (ref.type !== "appState") {
      return undefined
    }

    const [row] = await db.select().from(appState).where(eq(appState.id, ref.id)).limit(1)
    return row ? toDomain(row) : undefined
  }

  return {
    async list() {
      return (await db.select().from(appState)).map(toDomain)
    },

    async get(ref) {
      return getAppState(ref)
    },

    async insert(row) {
      await db.insert(appState).values(toInsert(row))
      return row
    },

    async upsert(row) {
      await db
        .insert(appState)
        .values(toInsert(row))
        .onConflictDoUpdate({
          set: toUpdate(row),
          target: appState.id,
        })
      return row
    },

    async update(ref, patch) {
      const current = await getAppState(ref)
      if (!current) {
        return
      }

      const next = {
        ...current,
        ...patch,
      } as AnyAppStateRow

      await db.update(appState).set(toUpdate(next)).where(eq(appState.id, ref.id))
    },

    async delete(ref) {
      if (ref.type !== "appState") {
        return
      }

      await db.delete(appState).where(eq(appState.id, ref.id))
    },
  }
}
