#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

type GrammarAssetKey = "highlights" | "wasm"

type GrammarSource = {
  id: string
  filetype: string
  aliases?: string[]
  sourceLabel: string
  sourceUrl: string
  archiveMatchers: Record<GrammarAssetKey, RegExp[]>
  outputFiles: Record<GrammarAssetKey, string>
}

const scriptPath = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptPath)
const projectRoot = path.resolve(scriptDir, "..")
const treeSitterRoot = path.join(projectRoot, "src", "apps", "tui", "tree-sitter")
const assetsRoot = path.join(treeSitterRoot, "assets")
const parserModulePath = path.join(treeSitterRoot, "parsers.ts")

const grammarSources = [
  {
    id: "sql",
    filetype: "sql",
    sourceLabel: "DerekStride/tree-sitter-sql gh-pages",
    sourceUrl: "https://github.com/DerekStride/tree-sitter-sql/archive/refs/heads/gh-pages.tar.gz",
    archiveMatchers: {
      wasm: [/(^|\/)tree-sitter-sql\.wasm$/i, /\.wasm$/i],
      highlights: [/(^|\/)queries\/highlights\.scm$/i, /(^|\/)highlights\.scm$/i],
    },
    outputFiles: {
      wasm: "tree-sitter-sql.wasm",
      highlights: "highlights.scm",
    },
  },
] as const satisfies readonly GrammarSource[]

function printUsage() {
  console.log(`Usage: bun scripts/fetch-treesitter-grammars.ts

Fetches vendored tree-sitter grammar assets into src/apps/tui/tree-sitter/assets
and regenerates src/apps/tui/tree-sitter/parsers.ts.

The script prefers a prebuilt wasm from the fetched archive. If the archive does
not contain one, it falls back to building the wasm locally with
\`tree-sitter build --wasm\`.

This currently fetches:
  - sql (${grammarSources[0].sourceLabel})
`)
}

function run(command: string, args: string[], cwd?: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`)
  }

  return result.stdout.trim()
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  const body = await response.arrayBuffer()
  await writeFile(destinationPath, new Uint8Array(body))
}

function listArchiveEntries(archivePath: string): string[] {
  return run("tar", ["-tzf", archivePath])
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function getArchiveRoot(entries: string[]): string {
  const firstEntry = entries[0]
  if (!firstEntry) {
    throw new Error("Archive is empty")
  }

  return firstEntry.split("/")[0]!
}

async function findMatchingFiles(rootDir: string, patterns: RegExp[]): Promise<string[]> {
  const matches: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/")
      if (patterns.some((pattern) => pattern.test(relativePath))) {
        matches.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  return matches
}

async function findSingleFile(rootDir: string, patterns: RegExp[], label: string): Promise<string | undefined> {
  for (const pattern of patterns) {
    const matches = await findMatchingFiles(rootDir, [pattern])
    if (matches.length === 1) {
      return matches[0]!
    }

    if (matches.length > 1) {
      throw new Error(`Found multiple files for ${label}: ${matches.join(", ")}`)
    }
  }

  return undefined
}

async function findProjectRoot(extractedRoot: string): Promise<string | undefined> {
  const configPath = await findSingleFile(extractedRoot, [/(^|\/)tree-sitter\.json$/], "tree-sitter.json")
  return configPath ? path.dirname(configPath) : undefined
}

async function ensureWasmFile(
  source: GrammarSource,
  extractedRoot: string,
): Promise<{ builtLocally: boolean; path: string }> {
  const prebuiltWasmPath = await findSingleFile(extractedRoot, source.archiveMatchers.wasm, `${source.id} wasm`)
  if (prebuiltWasmPath) {
    return {
      builtLocally: false,
      path: prebuiltWasmPath,
    }
  }

  const parserProjectRoot = await findProjectRoot(extractedRoot)
  if (!parserProjectRoot) {
    throw new Error(`Could not find tree-sitter.json for ${source.id}; cannot build wasm locally`)
  }

  console.log(`No prebuilt wasm found for ${source.id}; building locally in ${parserProjectRoot}`)
  run("tree-sitter", ["build", "--wasm"], parserProjectRoot)

  const builtWasmPath = await findSingleFile(parserProjectRoot, source.archiveMatchers.wasm, `${source.id} built wasm`)
  if (!builtWasmPath) {
    throw new Error(`Built ${source.id} locally but could not locate the generated wasm file`)
  }

  return {
    builtLocally: true,
    path: builtWasmPath,
  }
}

async function fetchGrammar(source: GrammarSource, workingDir: string): Promise<void> {
  console.log(`\nFetching ${source.id} from ${source.sourceLabel}`)

  const archivePath = path.join(workingDir, `${source.id}.tar.gz`)
  await downloadFile(source.sourceUrl, archivePath)

  const archiveEntries = listArchiveEntries(archivePath)
  const archiveRoot = getArchiveRoot(archiveEntries)
  run("tar", ["-xzf", archivePath, "-C", workingDir])

  const extractedRoot = path.join(workingDir, archiveRoot)
  const highlightPath = await findSingleFile(
    extractedRoot,
    source.archiveMatchers.highlights,
    `${source.id} highlights`,
  )
  if (!highlightPath) {
    throw new Error(`Could not find highlights query for ${source.id}`)
  }

  const wasm = await ensureWasmFile(source, extractedRoot)

  const outputDir = path.join(assetsRoot, source.filetype)
  await rm(outputDir, { force: true, recursive: true })
  await mkdir(outputDir, { recursive: true })

  await copyFile(wasm.path, path.join(outputDir, source.outputFiles.wasm))
  await copyFile(highlightPath, path.join(outputDir, source.outputFiles.highlights))

  const metadataPath = path.join(outputDir, "source.json")
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        sourceLabel: source.sourceLabel,
        sourceUrl: source.sourceUrl,
        builtLocally: wasm.builtLocally,
        sourceRoot: archiveRoot,
        sourceEntries: {
          highlights: path.relative(extractedRoot, highlightPath).split(path.sep).join("/"),
          wasm: path.relative(extractedRoot, wasm.path).split(path.sep).join("/"),
        },
      },
      null,
      2,
    ) + "\n",
  )

  console.log(`Saved ${source.id} assets to ${outputDir}`)
}

function buildParserModule(sources: readonly GrammarSource[]): string {
  const constants = sources
    .flatMap((source) => {
      const safeId = source.id.replace(/[^a-zA-Z0-9]/g, "_")
      return [
        `const ${safeId}Highlights = fileURLToPath(new URL("./assets/${source.filetype}/${source.outputFiles.highlights}", import.meta.url))`,
        `const ${safeId}Language = fileURLToPath(new URL("./assets/${source.filetype}/${source.outputFiles.wasm}", import.meta.url))`,
      ]
    })
    .join("\n")

  const parserEntries = sources
    .map((source) => {
      const safeId = source.id.replace(/[^a-zA-Z0-9]/g, "_")
      const aliasesLine = source.aliases?.length ? `        aliases: ${JSON.stringify(source.aliases)},\n` : ""
      return `      {
        filetype: "${source.filetype}",
${aliasesLine}        queries: {
          highlights: [${safeId}Highlights],
        },
        wasm: ${safeId}Language,
      }`
    })
    .join(",\n")

  return `// This file is generated by scripts/fetch-treesitter-grammars.ts. Do not edit manually.
// Run \`bun run fetch:treesitter-grammars\` to refresh vendored assets.

import { fileURLToPath } from "node:url"
import type { FiletypeParserOptions } from "@opentui/core"

${constants}

let cachedParsers: FiletypeParserOptions[] | undefined

export function getTreeSitterParsers(): FiletypeParserOptions[] {
  if (!cachedParsers) {
    cachedParsers = [
${parserEntries},
    ]
  }

  return cachedParsers
}
`
}

async function writeParserModule(sources: readonly GrammarSource[]): Promise<void> {
  await mkdir(treeSitterRoot, { recursive: true })
  await writeFile(parserModulePath, buildParserModule(sources))
  console.log(`Generated ${path.relative(projectRoot, parserModulePath)}`)
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: {
        type: "boolean",
      },
    },
    strict: true,
  })

  if (values.help) {
    printUsage()
    return
  }

  const workingDir = await mkdtemp(path.join(tmpdir(), "sqlv-tree-sitter-"))
  try {
    await mkdir(assetsRoot, { recursive: true })
    for (const source of grammarSources) {
      await fetchGrammar(source, workingDir)
    }
    await writeParserModule(grammarSources)
    console.log("\nDone.")
  } finally {
    await rm(workingDir, { force: true, recursive: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
