import type { OpenEditorSuggestionMenuInput } from "../SqlVisor"
import type { EditorRange, EditorSuggestionMenuTrigger, EditorSuggestionScope } from "./types"

export type MentionSuggestionTrigger = {
  query: string
  replacementRange: EditorRange
}

export type IdentifierSuggestionTrigger = {
  query: string
  replacementRange: EditorRange
}

export type EditorSuggestionSyncReason = "content" | "cursor"

export type EditorSuggestionMenuSnapshot = {
  open: boolean
  query: string
  replacementRange?: EditorRange
  scope?: EditorSuggestionScope
  trigger?: EditorSuggestionMenuTrigger
}

export type EditorSuggestionMenuDecision =
  | {
      kind: "open"
      input: OpenEditorSuggestionMenuInput
    }
  | {
      kind: "close"
    }
  | {
      kind: "none"
    }

export type DecideEditorSuggestionMenuInput = {
  cursorOffset: number
  menu: EditorSuggestionMenuSnapshot
  previousText: string
  reason: EditorSuggestionSyncReason
  selectedConnectionId?: string
  text: string
}

const OBJECT_NAME_PRECEDING_KEYWORDS = new Set([
  "from",
  "into",
  "join",
  "table",
  "update",
  "view",
])

export function decideEditorSuggestionMenu(input: DecideEditorSuggestionMenuInput): EditorSuggestionMenuDecision {
  const { cursorOffset, menu, previousText, reason, selectedConnectionId, text } = input
  const mentionTrigger = detectMentionSuggestionTrigger(text, cursorOffset)
  const hasOpenMentionMenu = menu.open && menu.trigger?.kind === "mention"
  const hasOpenIdentifierMenu = menu.open && menu.trigger?.kind === "identifier"

  if (mentionTrigger) {
    const shouldRefreshOpenMentionMenu =
      hasOpenMentionMenu &&
      (
        reason === "content" ||
        menu.query !== mentionTrigger.query ||
        !rangesEqual(menu.replacementRange, mentionTrigger.replacementRange)
      )
    const shouldOpenFromTriggerInsertion =
      !hasOpenMentionMenu &&
      reason === "content" &&
      didInsertMentionTrigger(previousText, text, mentionTrigger.replacementRange)

    if (shouldRefreshOpenMentionMenu || shouldOpenFromTriggerInsertion) {
      return {
        input: {
          cursorOffset,
          documentText: text,
          replacementRange: mentionTrigger.replacementRange,
          trigger: {
            context: {
              triggerText: "@",
            },
            kind: "mention",
            query: mentionTrigger.query,
          },
        },
        kind: "open",
      }
    }

    return { kind: "none" }
  }

  if (hasOpenMentionMenu) {
    return { kind: "close" }
  }

  const identifierTrigger = detectIdentifierSuggestionTrigger(text, cursorOffset)
  if (identifierTrigger && selectedConnectionId) {
    const scope = {
      connectionId: selectedConnectionId,
      kind: "selected-connection",
    } as const
    const shouldRefreshOpenIdentifierMenu =
      hasOpenIdentifierMenu &&
      (
        reason === "content" ||
        menu.query !== identifierTrigger.query ||
        !rangesEqual(menu.replacementRange, identifierTrigger.replacementRange) ||
        menu.scope?.kind !== scope.kind ||
        menu.scope?.connectionId !== scope.connectionId
      )
    const shouldOpenIdentifierMenu = !hasOpenIdentifierMenu && reason === "content"

    if (shouldRefreshOpenIdentifierMenu || shouldOpenIdentifierMenu) {
      return {
        input: {
          cursorOffset,
          documentText: text,
          replacementRange: identifierTrigger.replacementRange,
          scope,
          trigger: {
            context: {
              completionKind: "identifier",
            },
            kind: "identifier",
            query: identifierTrigger.query,
          },
        },
        kind: "open",
      }
    }

    return { kind: "none" }
  }

  if (hasOpenIdentifierMenu) {
    return { kind: "close" }
  }

  return { kind: "none" }
}

export function detectMentionSuggestionTrigger(text: string, cursorOffset: number): MentionSuggestionTrigger | undefined {
  const clampedCursorOffset = clampValue(cursorOffset, 0, text.length)
  let start = clampedCursorOffset
  while (start > 0 && !isMentionBoundaryCharacter(text[start - 1]!)) {
    start -= 1
  }

  let end = clampedCursorOffset
  while (end < text.length && !isMentionBoundaryCharacter(text[end]!)) {
    end += 1
  }

  const token = text.slice(start, end)
  if (!token.startsWith("@") || token.length < 1 || token.indexOf("@", 1) >= 0) {
    return undefined
  }

  return {
    query: token.slice(1),
    replacementRange: {
      end,
      start,
    },
  }
}

export function detectIdentifierSuggestionTrigger(text: string, cursorOffset: number): IdentifierSuggestionTrigger | undefined {
  const clampedCursorOffset = clampValue(cursorOffset, 0, text.length)
  let start = clampedCursorOffset
  while (start > 0 && isIdentifierPathCharacter(text[start - 1]!)) {
    start -= 1
  }

  let end = clampedCursorOffset
  while (end < text.length && isIdentifierPathCharacter(text[end]!)) {
    end += 1
  }

  const token = text.slice(start, end)
  if (!isSuggestableIdentifierPath(token) || !isObjectNameSuggestionContext(text, start)) {
    return undefined
  }

  return {
    query: token,
    replacementRange: {
      end,
      start,
    },
  }
}

function didInsertMentionTrigger(previousText: string, nextText: string, replacementRange: EditorRange): boolean {
  if (nextText.length <= previousText.length) {
    return false
  }

  const prefixLength = longestCommonPrefixLength(previousText, nextText)
  const suffixLength = longestCommonSuffixLength(previousText, nextText, prefixLength)
  const insertedText = nextText.slice(prefixLength, nextText.length - suffixLength)
  const removedText = previousText.slice(prefixLength, previousText.length - suffixLength)

  return insertedText === "@" && removedText === "" && replacementRange.start === prefixLength
}

function longestCommonPrefixLength(previousText: string, nextText: string): number {
  const maxLength = Math.min(previousText.length, nextText.length)
  let index = 0

  while (index < maxLength && previousText[index] === nextText[index]) {
    index += 1
  }

  return index
}

function longestCommonSuffixLength(previousText: string, nextText: string, prefixLength: number): number {
  const previousRemainderLength = previousText.length - prefixLength
  const nextRemainderLength = nextText.length - prefixLength
  const maxLength = Math.min(previousRemainderLength, nextRemainderLength)
  let index = 0

  while (
    index < maxLength &&
    previousText[previousText.length - 1 - index] === nextText[nextText.length - 1 - index]
  ) {
    index += 1
  }

  return index
}

function rangesEqual(left: EditorRange | undefined, right: EditorRange): boolean {
  return left?.start === right.start && left?.end === right.end
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
