import { describe, expect, test } from "bun:test"

import rule from "./layer-boundaries.ts"

type CapturedReport = {
  message: string
  fixText: string | null
}

type FixerLike = { replaceText(node: unknown, text: string): unknown }
type ReportArg = {
  node: unknown
  message: string
  fix?: (fixer: FixerLike) => unknown
}

type ImportShape = {
  importKind?: "type" | "value"
  specifierKinds?: Array<"type" | "value">
}

function makeContext(filename: string) {
  const reports: CapturedReport[] = []
  const context = {
    filename,
    report({ message, fix }: ReportArg) {
      let fixText: string | null = null
      if (fix) {
        const fixer: FixerLike = { replaceText: (_node, text) => text }
        fixText = fix(fixer) as string
      }
      reports.push({ message, fixText })
    },
  }
  return { context, reports }
}

function makeImport(specifier: string, shape: ImportShape = {}) {
  return {
    type: "ImportDeclaration" as const,
    source: { type: "Literal" as const, value: specifier },
    importKind: shape.importKind,
    specifiers: (shape.specifierKinds ?? []).map((importKind) => ({
      type: "ImportSpecifier" as const,
      importKind,
    })),
  }
}

function run(filename: string, specifier: string, shape: ImportShape = {}): CapturedReport[] {
  const { context, reports } = makeContext(filename)
  const visitors = rule.create(context)
  visitors.ImportDeclaration?.(makeImport(specifier, shape))
  return reports
}

const ROOT = "/abs"

describe("layer-boundaries", () => {
  describe("mode 1: same-layer #alias → relative", () => {
    test("autofixes same-layer alias to relative", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "#engine/runtime/QueryRunnerImpl")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("same-layer import should use a relative specifier")
      expect(reports[0]?.fixText).toBe('"./runtime/QueryRunnerImpl"')
    })

    test("computes the right relative path for sibling files", () => {
      const reports = run(`${ROOT}/src/domain/editor/state.ts`, "#domain/Connection")
      expect(reports[0]?.fixText).toBe('"../Connection"')
    })
  })

  describe("mode 2: cross-layer relative → #alias", () => {
    test("autofixes allowed cross-layer relative to alias", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "../domain/Connection")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("cross-layer import should use an alias")
      expect(reports[0]?.fixText).toBe('"#domain/Connection"')
    })

    test("autofixes forbidden cross-layer relative to alias AND reports error", () => {
      const reports = run(`${ROOT}/src/domain/Connection.ts`, "../spi/Adapter")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("'domain' may not import from layer 'spi'")
      expect(reports[0]?.message).toContain("still forbidden")
      expect(reports[0]?.fixText).toBe('"#spi/Adapter"')
    })
  })

  describe("mode 3: cross-layer alias dependency check", () => {
    test("allowed cross-layer alias passes silently", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "#domain/Connection")
      expect(reports).toEqual([])
    })

    test("engine may import api with import type", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "#api/ConnectionsApi", {
        importKind: "type",
      })
      expect(reports).toEqual([])
    })

    test("engine may import api when every imported specifier is type-only", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "#api/ConnectionsApi", {
        specifierKinds: ["type"],
      })
      expect(reports).toEqual([])
    })

    test("engine may not import api as a value", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "#api/ConnectionsApi")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("'engine' may not import from layer 'api'")
      expect(reports[0]?.fixText).toBeNull()
    })

    test("domain still may not import api even with import type", () => {
      const reports = run(`${ROOT}/src/domain/Connection.ts`, "#api/ConnectionsApi", {
        importKind: "type",
      })
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("'domain' may not import from layer 'api'")
      expect(reports[0]?.fixText).toBeNull()
    })

    test("forbidden cross-layer alias reports error without fix", () => {
      const reports = run(`${ROOT}/src/domain/Connection.ts`, "#spi/Adapter")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("'domain' may not import from layer 'spi'")
      expect(reports[0]?.fixText).toBeNull()
    })
  })

  describe("composition roots", () => {
    test("any layer may import a composition root directly", () => {
      const reports = run(`${ROOT}/src/apps/tui/index.tsx`, "#platforms/bun/createBunSqlVisor")
      expect(reports).toEqual([])
    })

    test("composition root itself may import any layer (including adapters)", () => {
      const reports = run(`${ROOT}/src/platforms/bun/createBunSqlVisor.ts`, "#adapters/sqlite/bun/BunSqliteAdapter")
      expect(reports).toEqual([])
    })

    test("non-composition-root platform file still restricted", () => {
      const reports = run(`${ROOT}/src/platforms/bun/storage/Storage.ts`, "#adapters/sqlite/sqlite")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("'platforms' may not import from layer 'adapters'")
      expect(reports[0]?.fixText).toBeNull()
    })

    test("test files may import from any layer", () => {
      // apps test legitimately needs domain types for fixtures
      const reports = run(`${ROOT}/src/apps/tui/form/CheckboxField.test.tsx`, "#domain/Connection")
      expect(reports).toEqual([])
    })

    test("test files still normalize alias/relative direction (mode 2 autofix)", () => {
      // relative cross-layer still gets rewritten to alias; no error
      const reports = run(`${ROOT}/src/apps/tui/form/CheckboxField.test.tsx`, "../../../domain/Connection")
      expect(reports).toHaveLength(1)
      expect(reports[0]?.message).toContain("cross-layer import should use an alias")
      expect(reports[0]?.message).not.toContain("forbidden")
      expect(reports[0]?.fixText).toBe('"#domain/Connection"')
    })
  })

  describe("ignored inputs", () => {
    test("bare-package specifiers are ignored", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "@tanstack/query-core")
      expect(reports).toEqual([])
    })

    test("node: specifiers are ignored", () => {
      const reports = run(`${ROOT}/src/platforms/bun/paths.ts`, "node:path")
      expect(reports).toEqual([])
    })

    test("same-layer relative imports are silent", () => {
      const reports = run(`${ROOT}/src/engine/SqlVisor.ts`, "./runtime/QueryRunnerImpl")
      expect(reports).toEqual([])
    })

    test("files outside any layer (e.g. src/tools) are skipped entirely", () => {
      const reports = run(`${ROOT}/src/tools/oxlint/plugin.ts`, "../../anywhere/forbidden")
      expect(reports).toEqual([])
    })

    test("the src/index.ts barrel is skipped", () => {
      const reports = run(`${ROOT}/src/index.ts`, "./engine/SqlVisor")
      expect(reports).toEqual([])
    })
  })
})
