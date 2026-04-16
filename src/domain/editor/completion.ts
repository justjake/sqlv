import type { EditorBuffer, EditorChange, EditorTextEdit } from "./buffer"
import type { EditorRange } from "./text"

export type EditorCompletionScopeMode = "all-connections" | "selected-connection"

export type EditorCompletionScope = {
  connectionId?: string
  kind: EditorCompletionScopeMode
}

export type EditorCompletionContext = {
  kind: string
  query: string
  replaceRange: EditorRange
  scope: EditorCompletionScope
}

export type SuggestionItem = {
  connectionId?: string
  detail?: string
  id: string
  insertText: string
  kind?: string
  label: string
}

export type EditorCompletionStatus = "closed" | "loading" | "ready" | "error"

export type EditorCompletionState = {
  context?: EditorCompletionContext
  error?: string
  focusedItemId?: string
  items: SuggestionItem[]
  status: EditorCompletionStatus
}

export type EditorCompletionItemRef = {
  id: string
}

export type EditorCompletionItemFocusInput =
  | EditorCompletionItemRef
  | {
      delta: number
    }
  | {
      index: number
    }

export type EditorCompletionDecision =
  | {
      context: EditorCompletionContext
      kind: "open"
    }
  | {
      kind: "close"
    }
  | {
      kind: "none"
    }

const OBJECT_NAME_PRECEDING_KEYWORDS = new Set(["from", "into", "join", "table", "update", "view"])

export function closedEditorCompletionState(): EditorCompletionState {
  return {
    items: [],
    status: "closed",
  }
}

export function resolveEditorCompletionScope(options: {
  preferredScope?: EditorCompletionScope
  scopeMode: EditorCompletionScopeMode
  selectedConnectionId?: string
}): EditorCompletionScope {
  const { preferredScope, scopeMode, selectedConnectionId } = options
  if (preferredScope) {
    return preferredScope
  }

  if (scopeMode === "selected-connection" && selectedConnectionId) {
    return {
      connectionId: selectedConnectionId,
      kind: "selected-connection",
    }
  }

  return {
    kind: "all-connections",
  }
}

export function decideEditorCompletion(input: {
  change: EditorChange
  completion: Pick<EditorCompletionState, "context" | "status">
  scopeMode: EditorCompletionScopeMode
  selectedConnectionId?: string
}): EditorCompletionDecision {
  const { change, completion, scopeMode, selectedConnectionId } = input
  const defaultScope = resolveEditorCompletionScope({ scopeMode, selectedConnectionId })
  const mentionContext = detectMentionCompletion(change.next, defaultScope)
  const hasOpenMentionCompletion = completion.status !== "closed" && completion.context?.kind === "mention"
  const hasOpenIdentifierCompletion = completion.status !== "closed" && completion.context?.kind === "identifier"

  if (mentionContext) {
    const shouldRefreshOpenMentionCompletion =
      hasOpenMentionCompletion &&
      (change.kind === "content" ||
        completion.context?.query !== mentionContext.query ||
        !rangesEqual(completion.context?.replaceRange, mentionContext.replaceRange) ||
        !scopesEqual(completion.context?.scope, mentionContext.scope))
    const shouldOpenFromTriggerInsertion =
      !hasOpenMentionCompletion &&
      change.kind === "content" &&
      didInsertMentionTrigger(change.edit, mentionContext.replaceRange)

    if (shouldRefreshOpenMentionCompletion || shouldOpenFromTriggerInsertion) {
      return {
        context: mentionContext,
        kind: "open",
      }
    }

    return { kind: "none" }
  }

  if (hasOpenMentionCompletion) {
    return { kind: "close" }
  }

  const identifierContext = detectIdentifierCompletion(change.next, selectedConnectionId)
  if (identifierContext) {
    const shouldRefreshOpenIdentifierCompletion =
      hasOpenIdentifierCompletion &&
      (change.kind === "content" ||
        completion.context?.query !== identifierContext.query ||
        !rangesEqual(completion.context?.replaceRange, identifierContext.replaceRange) ||
        !scopesEqual(completion.context?.scope, identifierContext.scope))
    const shouldOpenIdentifierCompletion = !hasOpenIdentifierCompletion && change.kind === "content"

    if (shouldRefreshOpenIdentifierCompletion || shouldOpenIdentifierCompletion) {
      return {
        context: identifierContext,
        kind: "open",
      }
    }

    return { kind: "none" }
  }

  if (hasOpenIdentifierCompletion) {
    return { kind: "close" }
  }

  return { kind: "none" }
}

export function detectMentionCompletion(
  buffer: EditorBuffer,
  scope: EditorCompletionScope,
): EditorCompletionContext | undefined {
  const clampedCursorOffset = clampValue(buffer.cursorOffset, 0, buffer.text.length)
  let start = clampedCursorOffset
  while (start > 0 && !isMentionBoundaryCharacter(buffer.text[start - 1]!)) {
    start -= 1
  }

  let end = clampedCursorOffset
  while (end < buffer.text.length && !isMentionBoundaryCharacter(buffer.text[end]!)) {
    end += 1
  }

  const token = buffer.text.slice(start, end)
  if (!token.startsWith("@") || token.indexOf("@", 1) >= 0) {
    return undefined
  }

  return {
    kind: "mention",
    query: token.slice(1),
    replaceRange: {
      end,
      start,
    },
    scope,
  }
}

export function detectIdentifierCompletion(
  buffer: EditorBuffer,
  selectedConnectionId: string | undefined,
): EditorCompletionContext | undefined {
  if (!selectedConnectionId) {
    return undefined
  }

  const clampedCursorOffset = clampValue(buffer.cursorOffset, 0, buffer.text.length)
  let start = clampedCursorOffset
  while (start > 0 && isIdentifierPathCharacter(buffer.text[start - 1]!)) {
    start -= 1
  }

  let end = clampedCursorOffset
  while (end < buffer.text.length && isIdentifierPathCharacter(buffer.text[end]!)) {
    end += 1
  }

  const token = buffer.text.slice(start, end)
  if (!isSuggestableIdentifierPath(token) || !isObjectNameSuggestionContext(buffer.text, start)) {
    return undefined
  }

  return {
    kind: "identifier",
    query: token,
    replaceRange: {
      end,
      start,
    },
    scope: {
      connectionId: selectedConnectionId,
      kind: "selected-connection",
    },
  }
}

function didInsertMentionTrigger(edit: EditorTextEdit | undefined, replaceRange: EditorRange): boolean {
  return (
    edit?.insertedText === "@" &&
    edit.removedText === "" &&
    edit.range.start === edit.range.end &&
    replaceRange.start === edit.range.start
  )
}

function rangesEqual(left: EditorRange | undefined, right: EditorRange): boolean {
  return left?.start === right.start && left?.end === right.end
}

function scopesEqual(left: EditorCompletionScope | undefined, right: EditorCompletionScope): boolean {
  return left?.kind === right.kind && left?.connectionId === right.connectionId
}

function isMentionBoundaryCharacter(char: string): boolean {
  return /\s|[()[\]{},;:+\-*/%<>=!?'"`|]/.test(char)
}

function isIdentifierPathCharacter(char: string): boolean {
  return /[A-Za-z0-9_$.]/.test(char)
}

function isSuggestableIdentifierPath(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(token)
}

function isObjectNameSuggestionContext(text: string, tokenStart: number): boolean {
  let cursor = tokenStart
  while (cursor > 0 && /\s/.test(text[cursor - 1]!)) {
    cursor -= 1
  }

  if (cursor === 0) {
    return false
  }

  if (text[cursor - 1] === ",") {
    return isObjectListContinuationContext(text, cursor - 1)
  }

  const previousToken = readIdentifierPathBackward(text, cursor)
  return previousToken ? OBJECT_NAME_PRECEDING_KEYWORDS.has(previousToken.toLowerCase()) : false
}

function isObjectListContinuationContext(text: string, commaIndex: number): boolean {
  let cursor = commaIndex
  while (cursor > 0 && /\s/.test(text[cursor - 1]!)) {
    cursor -= 1
  }

  const previousToken = readIdentifierPathBackward(text, cursor)
  if (!previousToken) {
    return false
  }

  cursor -= previousToken.length
  while (cursor > 0 && /\s/.test(text[cursor - 1]!)) {
    cursor -= 1
  }

  if (cursor === 0) {
    return false
  }

  if (text[cursor - 1] === ",") {
    return isObjectListContinuationContext(text, cursor - 1)
  }

  const previousKeyword = readIdentifierPathBackward(text, cursor)
  return previousKeyword ? OBJECT_NAME_PRECEDING_KEYWORDS.has(previousKeyword.toLowerCase()) : false
}

function readIdentifierPathBackward(text: string, end: number): string | undefined {
  let start = end
  while (start > 0 && isIdentifierPathCharacter(text[start - 1]!)) {
    start -= 1
  }

  return start === end ? undefined : text.slice(start, end)
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
