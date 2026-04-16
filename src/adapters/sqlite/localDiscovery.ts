import { readdir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

export async function findLocalSqliteDatabaseFiles(directory = process.cwd()): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && isLocalSqliteDatabaseFilename(entry.name))
      .map((entry) => join(directory, entry.name))
      .toSorted((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

export function isLocalSqliteDatabaseFilename(name: string): boolean {
  if (/-wal$/i.test(name) || /-shm$/i.test(name) || /\.lock$/i.test(name)) {
    return false
  }

  return /\.sqlite/i.test(name) || /\.db/i.test(name)
}

export function localDatabaseSuggestionName(filePath: string): string {
  return `${basename(dirname(filePath))}/${basename(filePath)}`
}
