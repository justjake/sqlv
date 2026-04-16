/**
 * Forbids raw `<text>` JSX elements in TUI code — callers should use the
 * themed `<Text>` wrapper from `#apps/tui/ui/Text` so typography/theme
 * defaults stay consistent.
 *
 * Scope:
 *   - Applies only to files under `src/apps/tui/`.
 *   - Exempts the wrapper itself (`src/apps/tui/ui/Text.tsx`) — it *is* the
 *     one place `<text>` should be written.
 *   - Exempts test files — they can render raw `<text>` as fixtures.
 *
 * Autofix: rewrites `<text>…</text>` → `<Text>…</Text>` and ensures
 * `import { Text } from "#apps/tui/ui/Text"` is present. If the source file
 * is itself inside the `apps` layer, layer-boundaries will rewrite that alias
 * to a relative specifier on the next fix pass.
 */

import { ensureNamedValueImport, type Fixer, type SourceCode } from "../lib/ensureImport.ts"
import { isTestFile } from "../layers.ts"

const TUI_DIR_SEGMENT = "/src/apps/tui/"
const WRAPPER_FILE_SUFFIX = "/src/apps/tui/ui/Text.tsx"
const TEXT_MODULE = "#apps/tui/ui/Text"
const TEXT_NAME = "Text"

type JSXIdentifier = { type: "JSXIdentifier"; name: string; range?: [number, number] }
type JSXOpeningElement = { type: "JSXOpeningElement"; name: { type: string; name?: string } }
type JSXClosingElement = { type: "JSXClosingElement"; name: { type: string; name?: string } }
type JSXElement = {
  type: "JSXElement"
  openingElement: JSXOpeningElement
  closingElement: JSXClosingElement | null
}

type ReportArg = { node: unknown; message: string; fix?: (fixer: Fixer) => unknown }

type LintContext = {
  filename?: string
  physicalFilename?: string
  getFilename?(): string
  sourceCode: SourceCode
  report(descriptor: ReportArg): void
}

function isRawTextTag(name: { type: string; name?: string }): name is JSXIdentifier {
  return name.type === "JSXIdentifier" && (name as JSXIdentifier).name === "text"
}

const rule = {
  meta: {
    type: "problem" as const,
    docs: {
      description: "Disallow raw `<text>` JSX elements in TUI code; use the themed `<Text>` wrapper instead.",
    },
    fixable: "code" as const,
    schema: [],
  },
  create(context: LintContext) {
    const filename = context.filename ?? context.physicalFilename ?? context.getFilename?.() ?? ""
    if (!filename.includes(TUI_DIR_SEGMENT)) return {}
    if (filename.endsWith(WRAPPER_FILE_SUFFIX)) return {}
    if (isTestFile(filename)) return {}

    // Per-file state: only the first fix carries the import insertion so
    // multiple reports in the same file don't produce overlapping edits.
    let importHandled = false

    return {
      JSXElement(node: JSXElement) {
        const opening = node.openingElement
        if (!isRawTextTag(opening.name)) return
        const openingName = opening.name as JSXIdentifier
        const closingName =
          node.closingElement && isRawTextTag(node.closingElement.name)
            ? (node.closingElement.name as JSXIdentifier)
            : null

        context.report({
          node: openingName,
          message: `Use the themed <${TEXT_NAME}> wrapper from '${TEXT_MODULE}' instead of raw <text>.`,
          fix: (fixer) => {
            const edits: unknown[] = []
            edits.push(fixer.replaceText(openingName, TEXT_NAME))
            if (closingName) edits.push(fixer.replaceText(closingName, TEXT_NAME))
            if (!importHandled) {
              importHandled = true
              const importFix = ensureNamedValueImport(context.sourceCode, TEXT_MODULE, TEXT_NAME)
              if (importFix) edits.push(importFix(fixer))
            }
            return edits
          },
        })
      },
    }
  },
}

export default rule
