import type { Connection } from "../model/Connection"
import type { EditorBuffer } from "../model/editor/buffer"
import type { EditorCompletionContext, SuggestionItem } from "../model/editor/completion"
import type { ObjectInfo } from "../model/objects"

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
