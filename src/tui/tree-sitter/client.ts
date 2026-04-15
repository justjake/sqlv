import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { Language, Parser, Query, type QueryCapture } from "web-tree-sitter"
import type { HighlightMeta, SimpleHighlight } from "@opentui/core"
import { getTreeSitterParsers } from "./parsers"

const require = createRequire(import.meta.url)
const parserOptionsByFiletype = new Map(getTreeSitterParsers().map((parser) => [parser.filetype, parser]))

const treeSitterRuntimeWasmPath = join(dirname(require.resolve("web-tree-sitter")), "web-tree-sitter.wasm")

type LoadedGrammar = {
  language: Language
  query: Query
}

let runtimeInitPromise: Promise<void> | undefined
const grammarPromises = new Map<string, Promise<LoadedGrammar>>()

export async function ensureTreeSitterGrammarLoaded(grammar: string | undefined): Promise<boolean> {
  if (!grammar) {
    return false
  }

  try {
    await loadGrammar(grammar)
    return true
  } catch {
    grammarPromises.delete(grammar)
    return false
  }
}

export async function highlightTreeSitterOnce(
  content: string,
  grammar: string,
): Promise<{ error?: string; highlights?: SimpleHighlight[] }> {
  try {
    const loadedGrammar = await loadGrammar(grammar)
    const parser = new Parser()
    parser.setLanguage(loadedGrammar.language)

    const tree = parser.parse(content)
    parser.delete()

    if (!tree) {
      return { highlights: [] }
    }

    try {
      const captures = loadedGrammar.query.captures(tree.rootNode)
      return {
        highlights: captures
          .map((capture) => createSimpleHighlight(capture))
          .filter((highlight): highlight is SimpleHighlight => highlight !== undefined),
      }
    } finally {
      tree.delete()
    }
  } catch (_error) {
    const error = _error instanceof Error ? _error : new Error(String(_error))
    return { error: error.message }
  }
}

async function initializeTreeSitterRuntime(): Promise<void> {
  if (!runtimeInitPromise) {
    runtimeInitPromise = Parser.init({
      locateFile() {
        return treeSitterRuntimeWasmPath
      },
    })
  }

  return runtimeInitPromise
}

async function loadGrammar(grammar: string): Promise<LoadedGrammar> {
  const existing = grammarPromises.get(grammar)
  if (existing) {
    return existing
  }

  const parserOptions = parserOptionsByFiletype.get(grammar)
  if (!parserOptions) {
    throw new Error(`No tree-sitter parser is configured for ${grammar}.`)
  }

  const promise = (async () => {
    await initializeTreeSitterRuntime()

    const [language, highlightQuerySources] = await Promise.all([
      Language.load(parserOptions.wasm),
      Promise.all(parserOptions.queries.highlights.map((path) => readFile(path, "utf8"))),
    ])

    return {
      language,
      query: new Query(language, highlightQuerySources.join("\n")),
    }
  })().catch((error) => {
    grammarPromises.delete(grammar)
    throw error
  })

  grammarPromises.set(grammar, promise)
  return promise
}

function createSimpleHighlight(capture: QueryCapture): SimpleHighlight | undefined {
  const start = capture.node.startIndex
  const end = capture.node.endIndex
  if (end <= start) {
    return undefined
  }

  const meta = createHighlightMeta(capture)
  if (meta) {
    return [start, end, capture.name, meta]
  }

  return [start, end, capture.name]
}

function createHighlightMeta(capture: QueryCapture): HighlightMeta | undefined {
  const conceal = capture.setProperties?.conceal
  const concealLines = capture.setProperties?.conceal_lines

  if (conceal === undefined && concealLines === undefined) {
    return undefined
  }

  return {
    conceal: conceal ?? undefined,
    concealLines: concealLines ?? undefined,
  }
}
