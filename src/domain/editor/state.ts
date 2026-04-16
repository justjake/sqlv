import { idleEditorAnalysisState, type EditorAnalysisState } from "./analysis"
import { createEditorBuffer, type EditorBuffer } from "./buffer"
import { closedEditorCompletionState, type EditorCompletionScopeMode, type EditorCompletionState } from "./completion"

export type EditorState = {
  analysis: EditorAnalysisState
  buffer: EditorBuffer
  completion: EditorCompletionState
  completionScopeMode: EditorCompletionScopeMode
  savedQueryId?: string
  treeSitterGrammar?: string
}

export function createEmptyEditorState(): EditorState {
  return {
    analysis: idleEditorAnalysisState(),
    buffer: createEditorBuffer(),
    completion: closedEditorCompletionState(),
    completionScopeMode: "all-connections",
  }
}
