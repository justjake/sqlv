export { BunSqlAdapter, type BunSqlConfig } from "./lib/adapters/BunSqlAdapter"
export {
  PostgresAdapter,
  postgres,
  postgresqlProtocolResolver,
  resolvePostgresConfig,
  type PostgresArg,
  type PostgresConfig,
  type PostgresqlProtocolResolution,
  type PostgresSQL,
} from "./lib/adapters/postgres"
export { sqlite, type SqliteArg, type SqliteSQL } from "./lib/adapters/sqlite"
export { TursoAdapter, type TursoConfig } from "./lib/adapters/TursoAdapter"
export { createLocalPersistence, createLocalPersistenceConnection } from "./lib/createLocalPersistence"
export { FocusTree } from "./lib/focus/FocusTree"
export { chooseNextFocusNavigable, type MeasuredFocusNode } from "./lib/focus/navigation"
export { ROOT_FOCUS_PATH, focusPath, focusPathAncestors, focusPathKey, focusPathSubpath, isAncestorFocusPath, sameFocusPath } from "./lib/focus/paths"
export {
  type FocusApplyContext,
  type FocusApplyReason,
  type FocusDirection,
  type FocusPath,
  type FocusPathSuffix,
  type FocusSnapshot,
  type FocusableId,
  type FocusableRegistration,
  type FocusNavigationState,
  type FocusRect,
  type FocusRevealOptions,
  type FocusTreeSnapshot,
  type FocusVisibleRect,
  type FocusAreaRegistration,
  type FocusNavigableId,
  type FocusNavigablePath,
  type FocusNavigationParticipant,
  type FocusNavigationSnapshot,
  type FocusNodeRegistration,
} from "./lib/focus/types"
export {
  AdapterRegistry,
  type Adapter,
  type ConnectionBooleanField,
  type ConnectionField,
  type ConnectionFormValue,
  type ConnectionFormValues,
  type ConnectionSelectField,
  type ConnectionSuggestion,
  type ConnectionSpec,
  type ConnectionSpecDraft,
  type ConnectionTextField,
  type Protocol,
  type ProtocolConfig,
} from "./lib/interface/Adapter"
export {
  SqlVisor,
  type AddConnectionInput,
  type ConnectionObjectsState,
  type ConnectionsState,
  type ConnectionSuggestionsState,
  type DiscoveredConnectionSuggestion,
  type QueryRef,
  type QueryExecutionState,
  type RestoreSavedQueryResult,
  type RunQueryInput,
  type SaveQueryAsNewInput,
  type SaveSavedQueryChangesInput,
  type SqlVisorCreateOptions,
  type SqlVisorState,
} from "./lib/SqlVisor"
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
} from "./lib/editor/analysis"
export {
  applyEditorBufferPatch,
  clampCursorOffset,
  createEditorBuffer,
  createEditorChange,
  type EditorBuffer,
  type EditorBufferPatch,
  type EditorChange,
  type EditorChangeKind,
  type EditorTextEdit,
} from "./lib/editor/buffer"
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
} from "./lib/editor/completion"
export { createEmptyEditorState, type EditorState } from "./lib/editor/state"
export { selectVisibleSuggestionItems } from "./lib/editor/suggestionMenu"
export { normalizeHighlightRange, offsetToLineColumn, replaceTextRange, type EditorRange } from "./lib/editor/text"
export {
  KnownObjectsSuggestionProvider,
} from "./lib/suggestions/KnownObjectsSuggestionProvider"
export { type SuggestionProvider, type SuggestionRequest } from "./lib/suggestions/types"
export { type SavedQuery } from "./lib/types/SavedQuery"
export {
  createSettingsRow,
  defaultSettingsState,
  type AnySettingsRow,
  type SettingsId,
  type SettingsRow,
  type SettingsSchema,
  type SettingsState,
  type SettingsStore,
} from "./lib/types/Settings"
export { type QueryExecution, type QueryExecutionStatus, type QueryFlow, type QueryInitiator } from "./lib/types/Log"
export {
  type ExplainColumn,
  type ExplainDiagnostic,
  type ExplainDiagnosticSeverity,
  type ExplainInput,
  type ExplainResult,
} from "./lib/types/Explain"
export {
  pendingQueryState,
  queryStateOrPending,
  type FetchStatus,
  type QueryState,
  type QueryStatus,
} from "./lib/types/QueryState"
export { SQL, unsafeRawSQL as rawSQL, sql, type SQLSourceOptions, type SQLValue } from "./lib/types/SQL"
