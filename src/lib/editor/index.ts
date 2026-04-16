export {
  createEditorAnalysisSubject,
  filterDisplayableEditorAnalysis,
  getDiagnosticLogicalLine,
  getVisibleEditorAnalysis,
  idleEditorAnalysisState,
  isIncompleteInputDiagnostic,
  type EditorAnalysisState,
  type EditorAnalysisStatus,
  type EditorAnalysisSubject,
} from "./analysis"
export {
  applyEditorBufferPatch,
  clampCursorOffset,
  createEditorBuffer,
  createEditorChange,
  diffEditorText,
  type EditorBuffer,
  type EditorBufferPatch,
  type EditorChange,
  type EditorChangeKind,
  type EditorTextEdit,
} from "./buffer"
export {
  closedEditorCompletionState,
  decideEditorCompletion,
  detectIdentifierCompletion,
  detectMentionCompletion,
  resolveEditorCompletionScope,
  type EditorCompletionContext,
  type EditorCompletionDecision,
  type EditorCompletionItemFocusInput,
  type EditorCompletionItemRef,
  type EditorCompletionScope,
  type EditorCompletionScopeMode,
  type EditorCompletionState,
  type EditorCompletionStatus,
  type SuggestionItem,
} from "./completion"
export { createEmptyEditorState, type EditorState } from "./state"
export { selectVisibleSuggestionItems } from "./suggestionMenu"
export { normalizeHighlightRange, offsetToLineColumn, replaceTextRange, type EditorRange } from "./text"
