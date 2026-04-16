/**
 * Reusable import-management helpers for custom oxlint rules.
 *
 * The key entry point is {@link ensureNamedValueImport}: given a source module
 * and a value name, it returns a fixer callback that makes the name available,
 * or `null` if nothing needs to change.
 *
 * Placement strategy: when a fresh import has to be added, it's inserted
 * before the first body node. `importx/order` will re-sort imports on its
 * own pass — we don't try to figure out the "right" slot here.
 */

export type Fixer = {
  replaceText(node: unknown, text: string): unknown
  insertTextBefore(node: unknown, text: string): unknown
  insertTextAfter(node: unknown, text: string): unknown
  insertTextBeforeRange(range: [number, number], text: string): unknown
  insertTextAfterRange(range: [number, number], text: string): unknown
  replaceTextRange(range: [number, number], text: string): unknown
  remove(node: unknown): unknown
  removeRange(range: [number, number]): unknown
}

export type FixEdit = (fixer: Fixer) => unknown

type Identifier = { type: "Identifier"; name: string; range?: [number, number] }
type StringLiteral = { type: "Literal"; value: string; range?: [number, number] }

type ImportSpecifier = {
  type: "ImportSpecifier"
  imported: Identifier | StringLiteral
  local: Identifier
  importKind?: "type" | "value"
  range?: [number, number]
}
type ImportDefaultSpecifier = {
  type: "ImportDefaultSpecifier"
  local: Identifier
  range?: [number, number]
}
type ImportNamespaceSpecifier = {
  type: "ImportNamespaceSpecifier"
  local: Identifier
  range?: [number, number]
}
type AnyImportSpecifier = ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier

export type ImportDeclaration = {
  type: "ImportDeclaration"
  source: StringLiteral
  specifiers: AnyImportSpecifier[]
  importKind?: "type" | "value"
  range?: [number, number]
}

type ProgramNode = {
  type: "Program"
  body: { type: string; [k: string]: unknown }[]
}

export type SourceCode = {
  ast: ProgramNode
}

function importedName(spec: ImportSpecifier): string {
  const imp = spec.imported
  if (imp.type === "Identifier") return imp.name
  return imp.value
}

function findValueImportDecl(ast: ProgramNode, source: string): ImportDeclaration | null {
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue
    const decl = node as unknown as ImportDeclaration
    if (decl.source.value !== source) continue
    if (decl.importKind === "type") continue
    return decl
  }
  return null
}

function hasNamedValue(decl: ImportDeclaration, name: string): boolean {
  return decl.specifiers.some((s) => {
    if (s.type !== "ImportSpecifier") return false
    if (s.importKind === "type") return false
    return importedName(s) === name
  })
}

/**
 * Ensure `name` is imported as a value from `source`. Returns a fixer callback
 * that applies the necessary edit, or `null` if the name is already imported.
 *
 * Handles:
 *  - no existing import from source → inserts a new `import { name } from "source"` line.
 *  - existing named import that lacks `name` → appends `, name` to the list.
 *  - existing import that has only default/namespace specifiers → appends `, { name }`.
 *  - existing type-only import (`import type { … } from source`) → treated as
 *    not-present; we add a separate value import (consumers can prefer a
 *    mixed import elsewhere).
 */
export function ensureNamedValueImport(
  sourceCode: SourceCode,
  source: string,
  name: string,
): FixEdit | null {
  const existing = findValueImportDecl(sourceCode.ast, source)
  if (existing && hasNamedValue(existing, name)) return null

  if (existing) {
    return (fixer) => mergeIntoExisting(fixer, existing, name)
  }

  const firstBody = sourceCode.ast.body[0]
  const line = `import { ${name} } from ${JSON.stringify(source)}\n`
  if (firstBody) {
    return (fixer) => fixer.insertTextBefore(firstBody, line)
  }
  return (fixer) => fixer.insertTextBeforeRange([0, 0], line)
}

function mergeIntoExisting(fixer: Fixer, decl: ImportDeclaration, name: string): unknown {
  const namedSpecs = decl.specifiers.filter((s): s is ImportSpecifier => s.type === "ImportSpecifier")
  if (namedSpecs.length > 0) {
    const last = namedSpecs[namedSpecs.length - 1]!
    return fixer.insertTextAfter(last, `, ${name}`)
  }
  // Only default and/or namespace — append a named-specifier group after the last one.
  const tail = decl.specifiers[decl.specifiers.length - 1]
  if (tail) {
    return fixer.insertTextAfter(tail, `, { ${name} }`)
  }
  // Degenerate: a bare side-effect import (`import "foo"`) with no specifiers.
  // Replace the whole declaration with a named import of the same source.
  const quoted = JSON.stringify(decl.source.value)
  if (decl.range) {
    return fixer.replaceTextRange(decl.range, `import { ${name} } from ${quoted}`)
  }
  return fixer.replaceText(decl, `import { ${name} } from ${quoted}`)
}
