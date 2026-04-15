import type { SqlVisor } from "../SqlVisor"

export type EditorRange = {
  start: number
  end: number
}

export type EditorSuggestionScopeMode = "all-connections" | "selected-connection"

export type EditorSuggestionScope = {
  kind: EditorSuggestionScopeMode
  connectionId?: string
}

export type EditorSuggestionMenuTrigger = {
  kind: string
  query?: string
  context?: Record<string, unknown>
}

export type SuggestionItem = {
  id: string
  label: string
  insertText: string
  detail?: string
  kind?: string
  connectionId?: string
}

export type SuggestionRequest = {
  engine: SqlVisor
  documentText: string
  cursorOffset: number
  replacementRange: EditorRange
  trigger: EditorSuggestionMenuTrigger
  scope: EditorSuggestionScope
  abortSignal: AbortSignal
}

export interface SuggestionProvider {
  id: string
  getSuggestions(request: SuggestionRequest): Promise<SuggestionItem[]>
}
