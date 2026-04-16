import { readdirSync, readFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { EditorRange } from "../../src/model/editor/text"

export type SqliteExampleErrorCase = {
  id: string
  message: string
  range?: EditorRange
  sql: string
}

const EXAMPLE_ERRORS_DIR = join(dirname(fileURLToPath(import.meta.url)), "exampleErrors")

export function loadSqliteExampleErrorCases(): SqliteExampleErrorCase[] {
  return readdirSync(EXAMPLE_ERRORS_DIR)
    .filter((entry) => extname(entry) === ".sql")
    .sort()
    .map((entry) => loadSqliteExampleErrorCase(entry.slice(0, -4)))
}

export function loadSqliteExampleErrorCase(id: string): SqliteExampleErrorCase {
  return parseSqliteExampleErrorCase(id, readFileSync(join(EXAMPLE_ERRORS_DIR, `${id}.sql`), "utf8"))
}

function parseSqliteExampleErrorCase(id: string, source: string): SqliteExampleErrorCase {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const metadata = new Map<string, string>()
  let bodyStart = 0

  while (bodyStart < lines.length) {
    const line = lines[bodyStart] ?? ""
    const trimmed = line.trim()

    if (!trimmed) {
      bodyStart += 1
      continue
    }

    if (!trimmed.startsWith("--")) {
      break
    }

    const match = trimmed.match(/^--\s*([a-zA-Z][a-zA-Z0-9_-]*):\s*(.+)$/)
    if (match) {
      const [, key, value] = match
      if (key && value) {
        metadata.set(key, value)
      }
    }
    bodyStart += 1
  }

  const sql = lines.slice(bodyStart).join("\n").trim()
  if (!sql) {
    throw new Error(`SQLite example error fixture "${id}" is missing SQL content.`)
  }

  const message = metadata.get("message")
  if (!message) {
    throw new Error(`SQLite example error fixture "${id}" is missing a -- message: header.`)
  }

  const range = parseRange(metadata.get("range"))
  return {
    id,
    message,
    range,
    sql,
  }
}

function parseRange(value: string | undefined): EditorRange | undefined {
  if (!value) {
    return undefined
  }

  const match = value.match(/^(\d+)-(\d+)$/)
  if (!match) {
    throw new Error(`Invalid sqlite example error range: "${value}". Expected start-end.`)
  }

  return {
    end: Number(match[2]),
    start: Number(match[1]),
  }
}
