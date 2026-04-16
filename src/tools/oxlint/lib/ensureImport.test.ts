import { describe, expect, test } from "bun:test"

import { ensureNamedValueImport, type Fixer, type SourceCode } from "./ensureImport.ts"

/**
 * Build a tiny ESTree-shaped AST from a declarative list of imports. This
 * keeps the tests focused on the helper's decision logic without depending
 * on a real parser.
 */
type ImportShape =
  | { kind: "named"; source: string; names: string[]; typeOnly?: boolean }
  | { kind: "default"; source: string; local: string }
  | { kind: "namespace"; source: string; local: string }
  | { kind: "side-effect"; source: string }
  | { kind: "mixed-default-named"; source: string; defaultLocal: string; names: string[] }

let nextRange = 100
function range(): [number, number] {
  const start = nextRange
  nextRange += 20
  return [start, start + 10]
}

function makeImport(shape: ImportShape): unknown {
  const base = {
    type: "ImportDeclaration",
    range: range(),
    source: { type: "Literal", value: shape.source, range: range() },
    importKind: "value" as string,
    specifiers: [] as unknown[],
  }
  if (shape.kind === "named") {
    base.importKind = shape.typeOnly ? "type" : "value"
    base.specifiers = shape.names.map((name) => ({
      type: "ImportSpecifier",
      imported: { type: "Identifier", name, range: range() },
      local: { type: "Identifier", name, range: range() },
      range: range(),
    }))
  } else if (shape.kind === "default") {
    base.specifiers = [
      {
        type: "ImportDefaultSpecifier",
        local: { type: "Identifier", name: shape.local, range: range() },
        range: range(),
      },
    ]
  } else if (shape.kind === "namespace") {
    base.specifiers = [
      {
        type: "ImportNamespaceSpecifier",
        local: { type: "Identifier", name: shape.local, range: range() },
        range: range(),
      },
    ]
  } else if (shape.kind === "mixed-default-named") {
    base.specifiers = [
      {
        type: "ImportDefaultSpecifier",
        local: { type: "Identifier", name: shape.defaultLocal, range: range() },
        range: range(),
      },
      ...shape.names.map((name) => ({
        type: "ImportSpecifier",
        imported: { type: "Identifier", name, range: range() },
        local: { type: "Identifier", name, range: range() },
        range: range(),
      })),
    ]
  }
  return base
}

function makeSourceCode(imports: ImportShape[]): SourceCode {
  nextRange = 100
  return {
    ast: {
      type: "Program",
      body: imports.map(makeImport) as { type: string; [k: string]: unknown }[],
    },
  }
}

type FixOp =
  | { kind: "insertBefore"; nodeTag: string; text: string }
  | { kind: "insertAfter"; nodeTag: string; text: string }
  | { kind: "replaceText"; nodeTag: string; text: string }
  | { kind: "replaceTextRange"; range: [number, number]; text: string }
  | { kind: "insertBeforeRange"; range: [number, number]; text: string }
  | { kind: "insertAfterRange"; range: [number, number]; text: string }

function tagOf(node: unknown): string {
  const n = node as { type?: string; name?: string; value?: string; source?: { value?: string } }
  if (n.type === "ImportDeclaration") return `ImportDeclaration(${n.source?.value})`
  if (n.type === "ImportSpecifier") {
    const imp = (n as unknown as { imported: { name?: string; value?: string } }).imported
    return `ImportSpecifier(${imp.name ?? imp.value})`
  }
  if (n.type === "ImportDefaultSpecifier") return `ImportDefaultSpecifier(${(n as unknown as { local: { name: string } }).local.name})`
  if (n.type === "ImportNamespaceSpecifier") return `ImportNamespaceSpecifier(${(n as unknown as { local: { name: string } }).local.name})`
  return n.type ?? "unknown"
}

function makeFixer(): { fixer: Fixer; ops: FixOp[] } {
  const ops: FixOp[] = []
  const fixer: Fixer = {
    replaceText(node, text) {
      ops.push({ kind: "replaceText", nodeTag: tagOf(node), text })
      return {}
    },
    insertTextBefore(node, text) {
      ops.push({ kind: "insertBefore", nodeTag: tagOf(node), text })
      return {}
    },
    insertTextAfter(node, text) {
      ops.push({ kind: "insertAfter", nodeTag: tagOf(node), text })
      return {}
    },
    insertTextBeforeRange(range, text) {
      ops.push({ kind: "insertBeforeRange", range, text })
      return {}
    },
    insertTextAfterRange(range, text) {
      ops.push({ kind: "insertAfterRange", range, text })
      return {}
    },
    replaceTextRange(range, text) {
      ops.push({ kind: "replaceTextRange", range, text })
      return {}
    },
    remove() {
      return {}
    },
    removeRange() {
      return {}
    },
  }
  return { fixer, ops }
}

describe("ensureNamedValueImport", () => {
  test("no-op when name already imported as a value", () => {
    const sourceCode = makeSourceCode([{ kind: "named", source: "#apps/tui/ui/Text", names: ["Text"] }])
    expect(ensureNamedValueImport(sourceCode, "#apps/tui/ui/Text", "Text")).toBeNull()
  })

  test("adds a fresh import when no prior import from the source exists", () => {
    const sourceCode = makeSourceCode([{ kind: "named", source: "other-module", names: ["Other"] }])
    const fix = ensureNamedValueImport(sourceCode, "#apps/tui/ui/Text", "Text")
    expect(fix).not.toBeNull()
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops).toEqual([
      {
        kind: "insertBefore",
        nodeTag: "ImportDeclaration(other-module)",
        text: 'import { Text } from "#apps/tui/ui/Text"\n',
      },
    ])
  })

  test("merges into an existing named import when a sibling name is present", () => {
    const sourceCode = makeSourceCode([{ kind: "named", source: "#apps/tui/ui/Text", names: ["ThemeProvider"] }])
    const fix = ensureNamedValueImport(sourceCode, "#apps/tui/ui/Text", "Text")
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops).toEqual([
      { kind: "insertAfter", nodeTag: "ImportSpecifier(ThemeProvider)", text: ", Text" },
    ])
  })

  test("appends to last specifier so `import { A, B, C }` becomes `import { A, B, C, Text }`", () => {
    const sourceCode = makeSourceCode([{ kind: "named", source: "mod", names: ["A", "B", "C"] }])
    const fix = ensureNamedValueImport(sourceCode, "mod", "Text")
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops).toEqual([{ kind: "insertAfter", nodeTag: "ImportSpecifier(C)", text: ", Text" }])
  })

  test("mixed default + named: merges into the named list", () => {
    const sourceCode = makeSourceCode([
      { kind: "mixed-default-named", source: "mod", defaultLocal: "Foo", names: ["Bar"] },
    ])
    const fix = ensureNamedValueImport(sourceCode, "mod", "Baz")
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops).toEqual([{ kind: "insertAfter", nodeTag: "ImportSpecifier(Bar)", text: ", Baz" }])
  })

  test("default-only existing import: appends `, { name }` after the default", () => {
    const sourceCode = makeSourceCode([{ kind: "default", source: "mod", local: "Foo" }])
    const fix = ensureNamedValueImport(sourceCode, "mod", "Text")
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops).toEqual([
      { kind: "insertAfter", nodeTag: "ImportDefaultSpecifier(Foo)", text: ", { Text }" },
    ])
  })

  test("existing type-only import does not satisfy value requirement; adds a fresh value import", () => {
    const sourceCode = makeSourceCode([
      { kind: "named", source: "#apps/tui/ui/Text", names: ["Text"], typeOnly: true },
    ])
    const fix = ensureNamedValueImport(sourceCode, "#apps/tui/ui/Text", "Text")
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops[0]?.kind).toBe("insertBefore")
    expect((ops[0] as { text: string }).text).toBe('import { Text } from "#apps/tui/ui/Text"\n')
  })

  test("empty file: inserts at range [0, 0]", () => {
    const sourceCode: SourceCode = { ast: { type: "Program", body: [] } }
    const fix = ensureNamedValueImport(sourceCode, "mod", "Text")
    const { fixer, ops } = makeFixer()
    fix!(fixer)
    expect(ops).toEqual([{ kind: "insertBeforeRange", range: [0, 0], text: 'import { Text } from "mod"\n' }])
  })
})
