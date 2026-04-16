import { eq } from "drizzle-orm"

import type { RowRef } from "#domain/RowStore"
import type { AnySettingsRow, SettingsStore } from "#domain/Settings"

import type { StorageDatabase } from "../boot"
import { settings } from "../schema/settings"

function toDomain(row: typeof settings.$inferSelect): AnySettingsRow {
  return {
    id: row.id,
    type: "settings",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? undefined,
    settings: row.settings,
  } as AnySettingsRow
}

function toInsert(row: AnySettingsRow): typeof settings.$inferInsert {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
    settings: row.settings,
  }
}

function toUpdate(row: AnySettingsRow) {
  return {
    settings: row.settings,
    updatedAt: row.updatedAt ?? null,
  } satisfies Omit<typeof settings.$inferInsert, "createdAt" | "id">
}

export function createSettingsStore(db: StorageDatabase): SettingsStore {
  const getSettings = async (ref: RowRef<AnySettingsRow>) => {
    if (ref.type !== "settings") {
      return undefined
    }

    const [row] = await db.select().from(settings).where(eq(settings.id, ref.id)).limit(1)
    return row ? toDomain(row) : undefined
  }

  return {
    async list() {
      return (await db.select().from(settings)).map(toDomain)
    },

    async get(ref) {
      return getSettings(ref)
    },

    async insert(row) {
      await db.insert(settings).values(toInsert(row))
      return row
    },

    async upsert(row) {
      await db
        .insert(settings)
        .values(toInsert(row))
        .onConflictDoUpdate({
          set: toUpdate(row),
          target: settings.id,
        })
      return row
    },

    async update(ref, patch) {
      const current = await getSettings(ref)
      if (!current) {
        return
      }

      const next = {
        ...current,
        ...patch,
      } as AnySettingsRow

      await db.update(settings).set(toUpdate(next)).where(eq(settings.id, ref.id))
    },

    async delete(ref) {
      if (ref.type !== "settings") {
        return
      }

      await db.delete(settings).where(eq(settings.id, ref.id))
    },
  }
}
