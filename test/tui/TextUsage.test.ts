import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO_ROOT = join(import.meta.dir, "../..")
const TUI_DIR = join(REPO_ROOT, "src/tui")
const TEXT_WRAPPER_FILE = join(TUI_DIR, "ui/Text.tsx")
const RAW_TEXT_ELEMENT_PATTERN = /<\/?text(?=[\s>])/

describe("TUI text usage", () => {
  test("uses the themed Text wrapper instead of raw text elements", () => {
    const offenders = walkTsxFiles(TUI_DIR)
      .filter((file) => file !== TEXT_WRAPPER_FILE)
      .filter((file) => RAW_TEXT_ELEMENT_PATTERN.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file))
      .sort()

    expect(offenders).toEqual([])
  })
})

function walkTsxFiles(rootDir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkTsxFiles(entryPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(entryPath)
    }
  }

  return files
}
