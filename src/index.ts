export { AdapterRegistry } from "./api/AdapterRegistry"
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
  type StorageStore,
  type SqlVisorCreateOptions,
  type SqlVisorStorage,
  type SqlVisorState,
} from "./api/SqlVisor"
export { createBunSqlVisor, type CreateBunSqlVisorOptions } from "./platforms/bun/createBunSqlVisor"
export { init } from "./api/init"
export { BunSqlAdapter, type BunSqlConfig } from "./adapters/sqlite/bun/BunSqliteAdapter"
export {
  PostgresAdapter,
  postgres,
  postgresqlProtocolResolver,
  resolvePostgresConfig,
  type PostgresArg,
  type PostgresConfig,
  type PostgresqlProtocolResolution,
  type PostgresSQL,
} from "./adapters/postgres/PgAdapter"
export { sqlite, type SqliteArg, type SqliteSQL } from "./adapters/sqlite/sqlite"
export { TursoAdapter, type TursoConfig } from "./adapters/sqlite/turso/TursoAdapter"
export {
  createLocalStorage,
  createLocalStorageConnection,
  createSession,
  defaultStorageLocation,
  type LocalStorage,
  type StorageStore as LocalStorageStore,
} from "./platforms/bun/storage/createLocalStorage"
export { FocusTree } from "./apps/framework/focus/FocusTree"
export { chooseNextFocusNavigable, type MeasuredFocusNode } from "./apps/framework/focus/navigation"
export {
  ROOT_FOCUS_PATH,
  focusPath,
  focusPathAncestors,
  focusPathKey,
  focusPathSubpath,
  isAncestorFocusPath,
  sameFocusPath,
} from "./apps/framework/focus/paths"
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
} from "./apps/framework/focus/types"
export {
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
} from "./spi/Adapter"
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
} from "./domain/editor/analysis"
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
} from "./domain/editor/buffer"
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
} from "./domain/editor/completion"
export { createEmptyEditorState, type EditorState } from "./domain/editor/state"
export { selectVisibleSuggestionItems } from "./domain/editor/suggestionMenu"
export { normalizeHighlightRange, offsetToLineColumn, replaceTextRange, type EditorRange } from "./domain/editor/text"
export { KnownObjectsSuggestionProvider } from "./engine/suggestions/KnownObjectsSuggestionProvider"
export { type SuggestionProvider, type SuggestionRequest } from "./spi/SuggestionProvider"
export { type SavedQuery } from "./domain/SavedQuery"
export {
  defaultAppState,
  type AppStateId,
  type AppStateRow,
  type AppStateSnapshot,
  type AppStateStore,
} from "./domain/AppState"
export {
  createSettingsRow,
  defaultSettingsState,
  type AnySettingsRow,
  type SettingsId,
  type SettingsRow,
  type SettingsSchema,
  type SettingsState,
  type SettingsStore,
} from "./domain/Settings"
export { type QueryExecution, type QueryExecutionStatus, type QueryFlow, type QueryInitiator } from "./domain/Log"
export {
  type ExplainColumn,
  type ExplainDiagnostic,
  type ExplainDiagnosticSeverity,
  type ExplainInput,
  type ExplainResult,
} from "./domain/Explain"
export {
  pendingQueryState,
  queryStateOrPending,
  type FetchStatus,
  type QueryState,
  type QueryStatus,
} from "./domain/QueryState"
export { SQL, unsafeRawSQL as rawSQL, sql, type SQLSourceOptions, type SQLValue } from "./domain/SQL"
