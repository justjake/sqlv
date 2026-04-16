import type { EditorRange } from "../suggestions"
import type { ExplainResult } from "../types/Explain"
import { normalizeHighlightRange, offsetToLineColumn } from "./text"

export type EditorAnalysisStateSnapshot = {
  connectionId?: string
  error?: string
  requestedText?: string
  result?: ExplainResult
  status: "idle" | "loading" | "ready" | "error"
}

export function getVisibleEditorAnalysis(
  text: string,
  analysis: EditorAnalysisStateSnapshot,
): EditorAnalysisStateSnapshot {
  if (analysis.status === "idle") {
    return analysis
  }

  if (analysis.requestedText !== text) {
    return { status: "idle" }
  }

  return filterDisplayableEditorAnalysis(analysis)
}

export function filterDisplayableEditorAnalysis(
  analysis: EditorAnalysisStateSnapshot,
): EditorAnalysisStateSnapshot {
  if (analysis.status !== "ready" || analysis.result?.status !== "invalid") {
    return analysis
  }

  const diagnostics = analysis.result.diagnostics.filter(
    (diagnostic) => !isIncompleteInputDiagnostic(diagnostic.message, diagnostic.code),
  )
  if (diagnostics.length === analysis.result.diagnostics.length) {
    return analysis
  }
  if (diagnostics.length === 0) {
    return { status: "idle" }
  }

  return {
    ...analysis,
    result: {
      ...analysis.result,
      diagnostics,
    },
  }
}

export function isIncompleteInputDiagnostic(message: string, code?: string): boolean {
  return code === "incomplete-input" || /\bincomplete input\b/i.test(message)
}

export function getDiagnosticLogicalLine(text: string, range: EditorRange | undefined): number | undefined {
  const normalizedRange = normalizeHighlightRange(text, range)
  if (!normalizedRange) {
    return undefined
  }

  return offsetToLineColumn(text, normalizedRange.start).line - 1
}
