import type { Connection } from "#domain/Connection"
import type { EditorBuffer } from "#domain/editor/buffer"
import type { EditorCompletionContext, SuggestionItem } from "#domain/editor/completion"
import type { ObjectInfo } from "#domain/objects"

export type SuggestionContext = {
  listConnections(): Connection<any>[]
  getConnectionObjects(connectionId: string): ObjectInfo[] | undefined
  loadConnectionObjects(connectionId: string): Promise<ObjectInfo[]>
}

export type SuggestionRequest = {
  abortSignal: AbortSignal
  buffer: EditorBuffer
  completion: EditorCompletionContext
  context: SuggestionContext
}

export interface SuggestionProvider {
  id: string
  getSuggestions(request: SuggestionRequest): Promise<SuggestionItem[]>
}
