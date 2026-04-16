import type { EditorRange } from "../suggestions"

export function replaceTextRange(text: string, range: EditorRange, replacement: string): string {
  return text.slice(0, range.start) + replacement + text.slice(range.end)
}

export function normalizeHighlightRange(rangeText: string, range: EditorRange | undefined): EditorRange | undefined {
  if (!range) {
    return undefined
  }

  const start = clampValue(range.start, 0, rangeText.length)
  const end = clampValue(range.end, 0, rangeText.length)
  if (end > start) {
    return { end, start }
  }
  if (start < rangeText.length) {
    return { end: start + 1, start }
  }
  if (start > 0) {
    return { end: start, start: start - 1 }
  }
  return undefined
}

export function offsetToLineColumn(
  text: string,
  offset: number,
): {
  column: number
  line: number
} {
  const clampedOffset = clampValue(offset, 0, text.length)
  let line = 1
  let lineStart = 0

  for (let index = 0; index < clampedOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1
      lineStart = index + 1
    }
  }

  return {
    column: clampedOffset - lineStart + 1,
    line,
  }
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
