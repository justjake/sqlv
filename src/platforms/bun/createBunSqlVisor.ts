import type { QueryClient } from "@tanstack/query-core"

import { SqlVisor } from "#engine/SqlVisor"
import { PostgresAdapter } from "#adapters/postgres/PgAdapter"
import { BunSqlAdapter } from "#adapters/sqlite/bun/BunSqliteAdapter"
import { TursoAdapter } from "#adapters/sqlite/turso/TursoAdapter"
import { AdapterRegistry, type AnyAdapter } from "#spi/Adapter"
import type { SuggestionProvider } from "#spi/SuggestionProvider"

import { defaultStoragePath } from "./paths"
import {
  createLocalStorage,
  getExistingLocalStorageEncryptionKey,
  type LocalStorage,
} from "./storage/createLocalStorage"

export type CreateBunSqlVisorOptions = {
  app?: string
  adapters?: AnyAdapter[]
  registry?: AdapterRegistry
  storage?: LocalStorage
  queryClient?: QueryClient
  suggestionProviders?: SuggestionProvider[]
}

export async function createBunSqlVisor(options: CreateBunSqlVisorOptions = {}): Promise<SqlVisor> {
  const app = options.app ?? "sqlv"
  const registry = options.registry ?? new AdapterRegistry()
  for (const adapter of options.adapters ?? builtInBunAdapters(app)) {
    if (!registry.has(adapter.protocol)) {
      registry.register(adapter)
    }
  }

  const storage = options.storage ?? (await createLocalStorage({ app }))
  return SqlVisor.create({
    storage,
    queryClient: options.queryClient,
    registry,
    suggestionProviders: options.suggestionProviders,
  })
}

export function builtInBunAdapters(app: string): AnyAdapter[] {
  return [
    new TursoAdapter({
      loadSystemKey: () => getExistingLocalStorageEncryptionKey(undefined, app),
      systemPath: defaultStoragePath(app),
    }),
    new BunSqlAdapter(),
    new PostgresAdapter(),
  ]
}
