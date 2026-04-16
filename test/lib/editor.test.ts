import { describe, expect, test } from "bun:test"
import {
  createEditorAnalysisSubject,
  getDiagnosticLogicalLine,
  getVisibleEditorAnalysis,
} from "../../src/domain/editor/analysis"
import { createEditorBuffer } from "../../src/domain/editor/buffer"
import { offsetToLineColumn, normalizeHighlightRange, replaceTextRange } from "../../src/domain/editor/text"
import { selectVisibleSuggestionItems } from "../../src/domain/editor/suggestionMenu"

describe("domain/editor", () => {
  test("hides stale analysis results and incomplete-input-only diagnostics", () => {
    const previousBuffer = createEditorBuffer("select 1")
    const nextBuffer = createEditorBuffer("select 2", "select 2".length, 1)

    expect(
      getVisibleEditorAnalysis(nextBuffer, {
        result: {
          columns: [],
          diagnostics: [],
          status: "ok",
        },
        status: "ready",
        subject: createEditorAnalysisSubject(previousBuffer),
      }),
    ).toEqual({ status: "idle" })

    const incompleteBuffer = createEditorBuffer("select")
    expect(
      getVisibleEditorAnalysis(incompleteBuffer, {
        result: {
          diagnostics: [
            {
              code: "incomplete-input",
              message: "incomplete input",
              severity: "error",
            },
          ],
          status: "invalid",
        },
        status: "ready",
        subject: createEditorAnalysisSubject(incompleteBuffer),
      }),
    ).toEqual({ status: "idle" })
  })

  test("normalizes highlight ranges and resolves line/column positions", () => {
    expect(normalizeHighlightRange("abc", { start: 1, end: 1 })).toEqual({ end: 2, start: 1 })
    expect(normalizeHighlightRange("abc", { start: 3, end: 3 })).toEqual({ end: 3, start: 2 })
    expect(normalizeHighlightRange("", { start: 0, end: 0 })).toBeUndefined()

    expect(offsetToLineColumn("select\nfrom users", "select\nfr".length)).toEqual({
      column: 3,
      line: 2,
    })
    expect(
      getDiagnosticLogicalLine("select\nfrom users", { start: "select\nfr".length, end: "select\nfrom".length }),
    ).toBe(1)
  })

  test("selects a focused window of visible suggestion items", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }, { id: "five" }]

    expect(selectVisibleSuggestionItems(items, "four", 3).map((item) => item.id)).toEqual(["three", "four", "five"])
    expect(selectVisibleSuggestionItems(items, undefined, 2).map((item) => item.id)).toEqual(["one", "two"])
  })

  test("replaces text ranges with inserted suggestion text", () => {
    expect(
      replaceTextRange("select * from us", { start: "select * from ".length, end: "select * from us".length }, "users"),
    ).toBe("select * from users")
  })
})
