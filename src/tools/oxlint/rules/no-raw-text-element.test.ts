import { describe, expect, test } from "bun:test"

import rule from "./no-raw-text-element.ts"

type FixOp = {
  kind: "replaceText" | "insertBefore" | "insertAfter" | "insertBeforeRange"
  target: string
  text: string
}

function tagOf(node: unknown): string {
  const n = node as { type?: string; name?: string; value?: string; source?: { value?: string } }
  if (n.type === "ImportDeclaration") return `ImportDeclaration(${n.source?.value})`
  if (n.type === "JSXIdentifier") return `JSXIdentifier(${n.name})`
  return n.type ?? "unknown"
}

type Report = { message: string; fixOps: FixOp[] }

function makeContext(filename: string, body: unknown[] = []) {
  const reports: Report[] = []
  const sourceCode = {
    ast: {
      type: "Program" as const,
      body: body as { type: string; [k: string]: unknown }[],
    },
  }
  const context = {
    filename,
    sourceCode,
    report({ node, message, fix }: { node: unknown; message: string; fix?: (fixer: unknown) => unknown }) {
      const fixOps: FixOp[] = []
      if (fix) {
        const fixer = {
          replaceText: (target: unknown, text: string) => {
            fixOps.push({ kind: "replaceText", target: tagOf(target), text })
            return {}
          },
          insertTextBefore: (target: unknown, text: string) => {
            fixOps.push({ kind: "insertBefore", target: tagOf(target), text })
            return {}
          },
          insertTextAfter: (target: unknown, text: string) => {
            fixOps.push({ kind: "insertAfter", target: tagOf(target), text })
            return {}
          },
          insertTextBeforeRange: (range: [number, number], text: string) => {
            fixOps.push({ kind: "insertBeforeRange", target: `[${range[0]},${range[1]}]`, text })
            return {}
          },
          insertTextAfterRange: () => ({}),
          replaceTextRange: () => ({}),
          remove: () => ({}),
          removeRange: () => ({}),
        }
        fix(fixer)
      }
      void node
      reports.push({ message, fixOps })
    },
  }
  return { context, reports }
}

function jsxIdent(name: string) {
  return { type: "JSXIdentifier" as const, name }
}

function jsxElement(tag: string, { selfClosing }: { selfClosing?: boolean } = {}) {
  return {
    type: "JSXElement" as const,
    openingElement: { type: "JSXOpeningElement" as const, name: jsxIdent(tag) },
    closingElement: selfClosing ? null : { type: "JSXClosingElement" as const, name: jsxIdent(tag) },
  }
}

const ROOT = "/abs"

describe("no-raw-text-element", () => {
  test("reports <text> in TUI code with autofix that renames opening + closing tags and adds import", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.tsx`, [
      { type: "ImportDeclaration", source: { type: "Literal", value: "react" }, specifiers: [] },
    ])
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text"))
    expect(reports).toHaveLength(1)
    const ops = reports[0]!.fixOps
    // Opening + closing tag renames
    expect(ops.some((o) => o.kind === "replaceText" && o.target === "JSXIdentifier(text)" && o.text === "Text")).toBe(true)
    expect(ops.filter((o) => o.kind === "replaceText" && o.text === "Text")).toHaveLength(2)
    // Import added before first body node
    expect(
      ops.some(
        (o) => o.kind === "insertBefore" && o.target === "ImportDeclaration(react)" && o.text.includes('import { Text }'),
      ),
    ).toBe(true)
  })

  test("self-closing <text /> renames only the opening tag", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.tsx`, [
      { type: "ImportDeclaration", source: { type: "Literal", value: "react" }, specifiers: [] },
    ])
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text", { selfClosing: true }))
    const ops = reports[0]!.fixOps
    expect(ops.filter((o) => o.kind === "replaceText" && o.text === "Text")).toHaveLength(1)
  })

  test("second <text> in same file omits the import fix so edits don't overlap", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.tsx`, [
      { type: "ImportDeclaration", source: { type: "Literal", value: "react" }, specifiers: [] },
    ])
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text"))
    visitors.JSXElement?.(jsxElement("text"))
    expect(reports).toHaveLength(2)
    const firstImportOps = reports[0]!.fixOps.filter((o) => o.text.includes('import { Text }'))
    const secondImportOps = reports[1]!.fixOps.filter((o) => o.text.includes('import { Text }'))
    expect(firstImportOps).toHaveLength(1)
    expect(secondImportOps).toHaveLength(0)
  })

  test("no import fix when Text is already imported from the wrapper module", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.tsx`, [
      {
        type: "ImportDeclaration",
        source: { type: "Literal", value: "#apps/tui/ui/Text" },
        specifiers: [
          {
            type: "ImportSpecifier",
            imported: { type: "Identifier", name: "Text" },
            local: { type: "Identifier", name: "Text" },
          },
        ],
      },
    ])
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text"))
    const ops = reports[0]!.fixOps
    expect(ops.filter((o) => o.text.includes('import {'))).toEqual([])
    // Still renames opening + closing
    expect(ops.filter((o) => o.kind === "replaceText" && o.text === "Text")).toHaveLength(2)
  })

  test("does not report <Text> (the themed wrapper usage)", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.tsx`)
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("Text"))
    expect(reports).toEqual([])
  })

  test("does not report other JSX elements", () => {
    for (const tag of ["box", "input", "View", "button"]) {
      const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.tsx`)
      const visitors = rule.create(context)
      visitors.JSXElement?.(jsxElement(tag))
      expect(reports).toEqual([])
    }
  })

  test("exempts the wrapper file itself", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/ui/Text.tsx`)
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text"))
    expect(reports).toEqual([])
  })

  test("exempts test files", () => {
    const { context, reports } = makeContext(`${ROOT}/src/apps/tui/Shortcut.test.tsx`)
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text"))
    expect(reports).toEqual([])
  })

  test("does not fire outside src/apps/tui/", () => {
    const { context, reports } = makeContext(`${ROOT}/src/engine/SqlVisor.ts`)
    const visitors = rule.create(context)
    visitors.JSXElement?.(jsxElement("text"))
    expect(reports).toEqual([])
  })
})
