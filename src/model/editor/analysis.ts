import type { ExplainResult } from "../Explain"
import type { EditorBuffer } from "./buffer"
import { normalizeHighlightRange, offsetToLineColumn, type EditorRange } from "./text"

export type EditorAnalysisStatus = "idle" | "loading" | "ready" | "error"

export type EditorAnalysisSubject = {
  connectionId?: string
  revision: number
  text: string
}

export type EditorAnalysisState = {
  error?: string
  result?: ExplainResult
  status: EditorAnalysisStatus
  subject?: EditorAnalysisSubject
}

export function getVisibleEditorAnalysis(buffer: EditorBuffer, analysis: EditorAnalysisState): EditorAnalysisState {
  if (analysis.status === "idle") {
    return analysis
  }

  if (analysis.subject?.revision !== buffer.revision) {
    return { status: "idle" }
  }

  return filterDisplayableEditorAnalysis(analysis)
}

export function filterDisplayableEditorAnalysis(analysis: EditorAnalysisState): EditorAnalysisState {
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

export function createEditorAnalysisSubject(buffer: EditorBuffer, connectionId?: string): EditorAnalysisSubject {
  return {
    connectionId,
    revision: buffer.revision,
    text: buffer.text,
  }
}

export function idleEditorAnalysisState(): EditorAnalysisState {
  return {
    status: "idle",
  }
}

export function getDiagnosticLogicalLine(text: string, range: EditorRange | undefined): number | undefined {
  const normalizedRange = normalizeHighlightRange(text, range)
  if (!normalizedRange) {
    return undefined
  }

  return offsetToLineColumn(text, normalizedRange.start).line - 1
}
