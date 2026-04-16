import { RGBA, createTextAttributes } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { act, useEffect, useState } from "react"
import { createEditorAnalysisSubject, type EditorAnalysisState } from "../../../src/lib/editor/analysis"
import { applyEditorBufferPatch, type EditorBufferPatch, type EditorChange } from "../../../src/lib/editor/buffer"
import { closedEditorCompletionState, type EditorCompletionState } from "../../../src/lib/editor/completion"
import { createEmptyEditorState, type EditorState } from "../../../src/lib/editor/state"
import {
  EditorView,
} from "../../../src/tui/editor/EditorView"
import { editorCursorLineColors } from "../../../src/tui/editor/syntaxHighlighting"
import { loadSqliteExampleErrorCase } from "../../sqlite/exampleErrors"
import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

type EditorStatePatch = Partial<Omit<EditorState, "analysis" | "buffer" | "completion">> & {
  analysis?: Partial<EditorAnalysisState>
  buffer?: EditorBufferPatch
  completion?: Partial<EditorCompletionState>
}

function createEditorState(patch: EditorStatePatch = {}): EditorState {
  const base = createEmptyEditorState()

  return {
    ...base,
    ...patch,
    analysis: {
      ...base.analysis,
      ...patch.analysis,
    },
    buffer: applyEditorBufferPatch(base.buffer, patch.buffer ?? {}),
    completion: {
      ...base.completion,
      ...patch.completion,
    },
  }
}

function applyEditorChange(current: EditorState, change: EditorChange): EditorState {
  return {
    ...current,
    buffer: change.next,
  }
}

describe("EditorView", () => {
  test("edits, executes, clears, and opens history from the editor", async () => {
    const changes: string[] = []
    const executions: string[] = []
    let historyCount = 0
    let saveAsNewCount = 0

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(createEditorState())

      return (
        <EditorView
          autoFocus
          editor={editor}
          onChange={(change) => {
            setEditor((current) => applyEditorChange(current, change))
            if (change.kind === "content") {
              changes.push(change.next.text)
            }
          }}
          onExecute={(sql) => executions.push(sql)}
          onHistory={() => (historyCount += 1)}
          onSaveAsNew={() => (saveAsNewCount += 1)}
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, kittyKeyboard: true, width: 80 })

    await act(async () => {
      await ui.mockInput.typeText("select 1")
      await ui.renderOnce()
      ui.mockInput.pressEnter({ ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("d", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("r", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("s", { ctrl: true, shift: true })
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("History")
    expect(ui.captureCharFrame()).toContain("Save New")
    expect(changes).toContain("select 1")
    expect(changes.at(-1)).toBe("")
    expect(executions).toEqual(["select 1"])
    expect(historyCount).toBe(1)
    expect(saveAsNewCount).toBe(0)
  })

  test("executes from the editor with command+return", async () => {
    const executions: string[] = []
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          buffer: {
            cursorOffset: "select 1".length,
            text: "select 1",
          },
        })}
        onExecute={(sql) => executions.push(sql)}
      />,
      { height: 12, kittyKeyboard: true, width: 80 },
    )

    await act(async () => {
      ui.mockInput.pressEnter({ super: true })
      await ui.renderOnce()
    })

    expect(executions).toEqual(["select 1"])
  })

  test("does not render an add-connection shortcut in the editor toolbar", async () => {
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          buffer: {
            text: "select 1",
          },
        })}
      />,
      { height: 12, width: 80 },
    )

    expect(ui.captureCharFrame()).not.toContain("Add Conn")
  })

  test("formats the editor query with option+f", async () => {
    let formatCount = 0

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          buffer: {
            cursorOffset: "select * from users".length,
            text: "select * from users",
          },
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onChange={(change) => {
            setEditor((current) => applyEditorChange(current, change))
          }}
          onFormatQuery={() => {
            formatCount += 1
            setEditor((current) => ({
              ...current,
              buffer: applyEditorBufferPatch(current.buffer, {
                cursorOffset: "select\n  *\nfrom\n  users".length,
                text: "select\n  *\nfrom\n  users",
              }),
            }))
          }}
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, kittyKeyboard: true, width: 80 })

    expect(ui.captureCharFrame()).toContain("Format")

    await dispatchInput(ui, () => ui.mockInput.pressKey("f", { meta: true }))

    expect(formatCount).toBe(1)
    expect(ui.captureCharFrame()).toContain("from")
    expect(ui.captureCharFrame()).toMatch(/\n\s*2\s+\*/m)
  })

  test("moves completion focus and applies the selected item", async () => {
    const focusInputs: Array<{ delta: number } | { id: string } | { index: number }> = []
    let applyCount = 0

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          buffer: {
            cursorOffset: 2,
            text: "@a",
          },
          completion: {
            context: {
              kind: "mention",
              query: "a",
              replaceRange: { end: 2, start: 0 },
              scope: { kind: "all-connections" },
            },
            focusedItemId: "users",
            items: [
              { id: "users", insertText: "users", kind: "table", label: "users" },
              { id: "audit_log", insertText: "audit_log", kind: "table", label: "audit_log" },
            ],
            status: "ready",
          },
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onApplyCompletionItem={() => {
            applyCount += 1
            setEditor((current) => {
              const item =
                current.completion.items.find((candidate) => candidate.id === current.completion.focusedItemId) ??
                current.completion.items[0]
              if (!current.completion.context || !item) {
                return current
              }

              return {
                ...current,
                buffer: applyEditorBufferPatch(current.buffer, {
                  cursorOffset: item.insertText.length,
                  text: item.insertText,
                }),
                completion: closedEditorCompletionState(),
              }
            })
          }}
          onChange={(change) => {
            setEditor((current) => applyEditorChange(current, change))
          }}
          onFocusCompletionItem={(input) => {
            focusInputs.push(input)
            setEditor((current) => {
              const items = current.completion.items
              if (items.length === 0) {
                return current
              }

              let focusedItemId = current.completion.focusedItemId ?? items[0]?.id
              if ("id" in input) {
                focusedItemId = items.some((item) => item.id === input.id) ? input.id : focusedItemId
              } else if ("index" in input) {
                focusedItemId = items[Math.min(Math.max(input.index, 0), items.length - 1)]?.id
              } else {
                const currentIndex = items.findIndex((item) => item.id === current.completion.focusedItemId)
                const nextIndex = Math.min(Math.max((currentIndex >= 0 ? currentIndex : 0) + input.delta, 0), items.length - 1)
                focusedItemId = items[nextIndex]?.id
              }

              return {
                ...current,
                completion: {
                  ...current.completion,
                  focusedItemId,
                },
              }
            })
          }}
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, width: 80 })
    expect(ui.captureCharFrame()).toContain("@a")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleDeferredRender(ui, 0)

    expect(focusInputs).toEqual([{ delta: 1 }])
    expect(applyCount).toBe(1)
    expect(ui.captureCharFrame()).toContain("audit_log")
    expect(ui.captureCharFrame()).not.toContain("users table")
  })

  test("renders inline invalid-query diagnostics with an underlined error span", async () => {
    const example = loadSqliteExampleErrorCase("near-from")

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          buffer: {
            text: example.sql,
          },
        }),
      )

      useEffect(() => {
        setEditor((current) => ({
          ...current,
          analysis: {
            result: {
              diagnostics: [
                {
                  message: example.message,
                  range: example.range,
                  severity: "error",
                },
              ],
              status: "invalid",
            },
            status: "ready",
            subject: createEditorAnalysisSubject(current.buffer),
          },
        }))
      }, [])

      return <EditorView autoFocus editor={editor} />
    }

    const ui = await render(<Harness />, { height: 12, width: 80 })

    await settleDeferredRender(ui, 0)

    const frame = ui.captureCharFrame()
    expect(frame).toContain(example.message)
    expect(frame).not.toContain("Invalid query")
    expect(frame).not.toContain("L1:C8-11")

    const inlineDiagnosticLine = frame.split("\n").find((line) => line.includes(example.message))
    expect(inlineDiagnosticLine).toContain(example.sql)

    const sqlLine = ui
      .captureSpans()
      .lines.find((line) => line.spans.map((span) => span.text).join("").includes(example.sql))
    const underlineAttributes = createTextAttributes({ underline: true })
    const highlightedSpan = sqlLine?.spans.find((span) => span.text.includes("from"))

    expect(highlightedSpan).toBeDefined()
    expect((highlightedSpan?.attributes ?? 0) & underlineAttributes).toBe(underlineAttributes)
  })

  test("does not render query-valid analysis chrome", async () => {
    const editor = createEditorState({
      buffer: {
        text: "select 1",
      },
    })

    const ui = await render(
      <EditorView
        autoFocus
        editor={{
          ...editor,
          analysis: {
            result: {
              columns: [{ name: "value", type: "INTEGER" }],
              diagnostics: [],
              status: "ok",
            },
            status: "ready",
            subject: createEditorAnalysisSubject(editor.buffer),
          },
        }}
      />,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()
    expect(frame).not.toContain("Query is valid")
    expect(frame).not.toContain("Columns:")
  })

  test("does not render incomplete-input analysis while the statement is unfinished", async () => {
    const editor = createEditorState({
      buffer: {
        text: "select",
      },
    })

    const ui = await render(
      <EditorView
        autoFocus
        editor={{
          ...editor,
          analysis: {
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
            subject: createEditorAnalysisSubject(editor.buffer),
          },
        }}
      />,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()
    expect(frame).not.toContain("incomplete input")

    const sqlLine = ui
      .captureSpans()
      .lines.find((line) => line.spans.map((span) => span.text).join("").includes("select"))
    const underlineAttributes = createTextAttributes({ underline: true })

    expect(sqlLine?.spans.some((span) => ((span.attributes ?? 0) & underlineAttributes) === underlineAttributes)).toBe(false)
  })

  test("renders line numbers beside multiline editor content", async () => {
    const sql = "select 1\nfrom users\nwhere active = 1"
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          buffer: {
            text: sql,
          },
        })}
      />,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()

    expect(frame).toMatch(/\n\s*1\s+select 1/m)
    expect(frame).toMatch(/\n\s*2\s+from users/m)
    expect(frame).toMatch(/\n\s*3\s+where active = 1/m)
  })

  test("subtly highlights the row containing the cursor", async () => {
    const sql = "select 1\nfrom users\nwhere active = 1"
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          buffer: {
            cursorOffset: "select 1\nfrom".length,
            text: sql,
          },
        })}
      />,
      { height: 12, width: 80 },
    )

    const highlightedRow = ui
      .captureSpans()
      .lines.find((line) => line.spans.map((span) => span.text).join("").includes("from users"))
    const lineHighlightBg = RGBA.fromHex(editorCursorLineColors.contentBackgroundColor)

    expect(highlightedRow?.spans.some((span) => span.bg?.equals(lineHighlightBg))).toBe(true)
  })

  test("renders tree-sitter SQL highlights with base16 circus colors", async () => {
    const sql = "select count(*) from users where active = 1"
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          buffer: {
            text: sql,
          },
          treeSitterGrammar: "sql",
        })}
      />,
      { height: 12, width: 80 },
    )

    await settleDeferredRender(ui, 150)

    const sqlLine = ui
      .captureSpans()
      .lines.find((line) => line.spans.map((span) => span.text).join("").includes(sql))
    const keywordSpan = sqlLine?.spans.find((span) => span.text.toLowerCase().includes("select"))
    const functionSpan = sqlLine?.spans.find((span) => span.text.toLowerCase().includes("count"))
    const numberSpan = sqlLine?.spans.filter((span) => span.text.includes("1")).at(-1)

    expect(keywordSpan?.fg?.equals(RGBA.fromHex("#b888e2"))).toBe(true)
    expect(functionSpan?.fg?.equals(RGBA.fromHex("#639ee4"))).toBe(true)
    expect(numberSpan?.fg?.equals(RGBA.fromHex("#84b97c"))).toBe(true)
  })
})
