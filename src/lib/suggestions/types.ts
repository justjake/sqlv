import type { SqlVisor } from "../SqlVisor"
import type { EditorBuffer } from "../editor/buffer"
import type { EditorCompletionContext, SuggestionItem } from "../editor/completion"

export type SuggestionRequest = {
  abortSignal: AbortSignal
  buffer: EditorBuffer
  completion: EditorCompletionContext
  engine: SqlVisor
}

export interface SuggestionProvider {
  id: string
  getSuggestions(request: SuggestionRequest): Promise<SuggestionItem[]>
}
