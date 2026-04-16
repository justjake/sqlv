export type ExplainDiagnosticSeverity = "error" | "warning" | "info"

export type ExplainDiagnostic = {
  severity: ExplainDiagnosticSeverity
  message: string
  range?: {
    start: number
    end: number
  }
  code?: string
}

export type ExplainColumn = {
  name: string
  type?: string
  nullable?: boolean
}

export type ExplainResult = {
  status: "ok" | "invalid" | "unsupported"
  diagnostics: ExplainDiagnostic[]
  columns?: ExplainColumn[]
}

export type ExplainInput = {
  text: string
  abortSignal: AbortSignal
}
