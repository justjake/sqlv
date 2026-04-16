import type { EditorRange } from "./text"

export type EditorBuffer = {
  cursorOffset: number
  revision: number
  text: string
}

export type EditorBufferPatch = Partial<Pick<EditorBuffer, "cursorOffset" | "text">>

export type EditorTextEdit = {
  insertedText: string
  range: EditorRange
  removedText: string
}

export type EditorChangeKind = "content" | "cursor"

export type EditorChange = {
  edit?: EditorTextEdit
  kind: EditorChangeKind
  next: EditorBuffer
  previous: EditorBuffer
}

export function createEditorBuffer(text = "", cursorOffset = text.length, revision = 0): EditorBuffer {
  return {
    cursorOffset: clampCursorOffset(cursorOffset, text.length),
    revision,
    text,
  }
}

export function applyEditorBufferPatch(current: EditorBuffer, patch: EditorBufferPatch): EditorBuffer {
  const text = patch.text ?? current.text
  const cursorOffset = clampCursorOffset(patch.cursorOffset ?? current.cursorOffset, text.length)

  if (text === current.text && cursorOffset === current.cursorOffset) {
    return current
  }

  return {
    cursorOffset,
    revision: text === current.text ? current.revision : current.revision + 1,
    text,
  }
}

export function createEditorChange(
  previous: EditorBuffer,
  patch: EditorBufferPatch,
  kind: EditorChangeKind,
): EditorChange {
  const next = applyEditorBufferPatch(previous, patch)

  return {
    edit: kind === "content" && previous.text !== next.text ? diffEditorText(previous.text, next.text) : undefined,
    kind,
    next,
    previous,
  }
}

export function clampCursorOffset(cursorOffset: number, textLength: number): number {
  return Math.min(Math.max(cursorOffset, 0), textLength)
}

export function diffEditorText(previousText: string, nextText: string): EditorTextEdit {
  const prefixLength = longestCommonPrefixLength(previousText, nextText)
  const suffixLength = longestCommonSuffixLength(previousText, nextText, prefixLength)
  const previousEnd = previousText.length - suffixLength
  const nextEnd = nextText.length - suffixLength

  return {
    insertedText: nextText.slice(prefixLength, nextEnd),
    range: {
      end: previousEnd,
      start: prefixLength,
    },
    removedText: previousText.slice(prefixLength, previousEnd),
  }
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

  while (index < maxLength && previousText[previousText.length - 1 - index] === nextText[nextText.length - 1 - index]) {
    index += 1
  }

  return index
}
