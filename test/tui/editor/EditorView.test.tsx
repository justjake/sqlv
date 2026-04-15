import { RGBA, createTextAttributes } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { act, useEffect, useState } from "react"
import type { EditorState, OpenEditorSuggestionMenuInput } from "../../../src/index"
import { EditorView } from "../../../src/tui/editor/EditorView"
import { editorCursorLineColors } from "../../../src/tui/editor/syntaxHighlighting"
import { loadSqliteExampleErrorCase } from "../../sqlite/exampleErrors"
import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

function createEditorState(patch: Partial<EditorState> = {}): EditorState {
  return {
    analysis: {
      status: "idle",
      ...patch.analysis,
    },
    cursorOffset: patch.cursorOffset ?? 0,
    suggestionMenu: {
      items: [],
      open: false,
      query: "",
      status: "closed",
      ...patch.suggestionMenu,
    },
    suggestionScopeMode: patch.suggestionScopeMode ?? "all-connections",
    text: patch.text ?? "",
    treeSitterGrammar: patch.treeSitterGrammar,
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
          onEditorChange={(patch) => {
            setEditor((current) => ({
              ...current,
              ...patch,
            }))
            if (patch.text !== undefined) {
              changes.push(patch.text)
            }
          }}
          onExecute={(sql: string) => executions.push(sql)}
          onHistory={() => (historyCount += 1)}
          onSaveAsNew={() => (saveAsNewCount += 1)}
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, kittyKeyboard: true, width: 80 })

    await act(async () => {
      await ui.mockInput.typeText("select 1")
      await ui.renderOnce()
      ui.mockInput.pressKey("x", { ctrl: true })
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

  test("formats the editor query with option+f", async () => {
    let formatCount = 0

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          cursorOffset: "select * from users".length,
          text: "select * from users",
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onEditorChange={(patch) => {
            setEditor((current) => ({
              ...current,
              ...patch,
            }))
          }}
          onFormatQuery={() => {
            formatCount += 1
            setEditor((current) => ({
              ...current,
              cursorOffset: "select\n  *\nfrom\n  users".length,
              text: "select\n  *\nfrom\n  users",
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

  test("opens mention suggestions, moves focus, and applies the selected item", async () => {
    const opens: OpenEditorSuggestionMenuInput[] = []
    const focusInputs: Array<{ delta: number } | { id: string } | { index: number }> = []
    let applyCount = 0

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          suggestionMenu: {
            focusedItemId: "users",
            items: [
              { id: "users", insertText: "users", kind: "table", label: "users" },
              { id: "audit_log", insertText: "audit_log", kind: "table", label: "audit_log" },
            ],
            open: true,
            query: "a",
            replacementRange: { start: 0, end: 2 },
            status: "ready",
            trigger: { kind: "mention", query: "a" },
          },
          text: "@a",
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onApplySuggestionMenuItem={() => {
            applyCount += 1
            setEditor((current) => {
              const focusedItem = current.suggestionMenu.items.find((item) => item.id === current.suggestionMenu.focusedItemId)
              const nextText = focusedItem?.insertText ?? current.text
              return {
                ...current,
                cursorOffset: nextText.length,
                suggestionMenu: {
                  items: [],
                  open: false,
                  query: "",
                  status: "closed",
                },
                text: nextText,
              }
            })
          }}
          onEditorChange={(patch) => {
            setEditor((current) => ({
              ...current,
              ...patch,
            }))
          }}
          onFocusSuggestionMenuItem={(input) => {
            focusInputs.push(input)
            setEditor((current) => {
              const items = current.suggestionMenu.items
              if (!("delta" in input) || items.length === 0) {
                return current
              }
              const currentIndex = items.findIndex((item) => item.id === current.suggestionMenu.focusedItemId)
              const nextIndex = Math.min(Math.max((currentIndex >= 0 ? currentIndex : 0) + input.delta, 0), items.length - 1)
              return {
                ...current,
                suggestionMenu: {
                  ...current.suggestionMenu,
                  focusedItemId: items[nextIndex]?.id,
                },
              }
            })
          }}
          onOpenSuggestionMenu={(input) => {
            opens.push(input)
          }}
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, width: 80 })

    expect(ui.captureCharFrame()).toContain("users")
    expect(ui.captureCharFrame()).toContain("audit_log")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })

    await act(async () => {
      await ui.mockInput.typeText(" ")
      await ui.renderOnce()
      await ui.mockInput.typeText("@")
      await ui.renderOnce()
    })

    expect(focusInputs).toEqual([{ delta: 1 }])
    expect(applyCount).toBe(1)
    expect(opens.at(-1)).toMatchObject({
      trigger: {
        context: {
          triggerText: "@",
        },
        kind: "mention",
        query: "",
      },
    })
  })

  test("does not open mention suggestions when backspacing into an existing mention token", async () => {
    const opens: OpenEditorSuggestionMenuInput[] = []

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          cursorOffset: 3,
          text: "@ab",
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onEditorChange={(patch) => {
            setEditor((current) => ({
              ...current,
              ...patch,
            }))
          }}
          onOpenSuggestionMenu={(input) => {
            opens.push(input)
          }}
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, width: 80 })

    await act(async () => {
      ui.mockInput.pressKey("backspace")
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("@a")
    expect(opens).toEqual([])
  })

  test("opens natural identifier suggestions for the selected connection only", async () => {
    const opens: OpenEditorSuggestionMenuInput[] = []

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          cursorOffset: "select * from ".length,
          text: "select * from ",
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onEditorChange={(patch) => {
            setEditor((current) => ({
              ...current,
              ...patch,
            }))
          }}
          onOpenSuggestionMenu={(input) => {
            opens.push(input)
          }}
          selectedConnectionId="conn-1"
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, width: 80 })

    await act(async () => {
      await ui.mockInput.typeText("us")
      await ui.renderOnce()
    })

    expect(opens.at(-1)).toEqual({
      cursorOffset: "select * from us".length,
      documentText: "select * from us",
      replacementRange: {
        end: "select * from us".length,
        start: "select * from ".length,
      },
      scope: {
        connectionId: "conn-1",
        kind: "selected-connection",
      },
      trigger: {
        context: {
          completionKind: "identifier",
        },
        kind: "identifier",
        query: "us",
      },
    })
  })

  test("does not open natural identifier suggestions outside object-name contexts", async () => {
    const opens: OpenEditorSuggestionMenuInput[] = []

    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          cursorOffset: "select ".length,
          text: "select ",
        }),
      )

      return (
        <EditorView
          autoFocus
          editor={editor}
          onEditorChange={(patch) => {
            setEditor((current) => ({
              ...current,
              ...patch,
            }))
          }}
          onOpenSuggestionMenu={(input) => {
            opens.push(input)
          }}
          selectedConnectionId="conn-1"
        />
      )
    }

    const ui = await render(<Harness />, { height: 12, width: 80 })

    await act(async () => {
      await ui.mockInput.typeText("us")
      await ui.renderOnce()
    })

    expect(opens).toEqual([])
  })

  test("renders inline invalid-query diagnostics with an underlined error span", async () => {
    const example = loadSqliteExampleErrorCase("near-from")
    function Harness() {
      const [editor, setEditor] = useState<EditorState>(
        createEditorState({
          text: example.sql,
        }),
      )

      useEffect(() => {
        setEditor((current) => ({
          ...current,
          analysis: {
            requestedText: example.sql,
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

    const sqlLine = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes(example.sql))
    const underlineAttributes = createTextAttributes({ underline: true })
    const highlightedSpan = sqlLine?.spans.find((span) => span.text.includes("from"))

    expect(highlightedSpan).toBeDefined()
    expect((highlightedSpan?.attributes ?? 0) & underlineAttributes).toBe(underlineAttributes)
  })

  test("does not render query-valid analysis chrome", async () => {
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          analysis: {
            requestedText: "select 1",
            result: {
              columns: [{ name: "value", type: "INTEGER" }],
              diagnostics: [],
              status: "ok",
            },
            status: "ready",
          },
          text: "select 1",
        })}
      />,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()
    expect(frame).not.toContain("Query is valid")
    expect(frame).not.toContain("Columns:")
  })

  test("does not render incomplete-input analysis while the statement is unfinished", async () => {
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          analysis: {
            requestedText: "select",
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
          },
          text: "select",
        })}
      />,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()
    expect(frame).not.toContain("incomplete input")

    const sqlLine = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("select"))
    const underlineAttributes = createTextAttributes({ underline: true })

    expect(sqlLine?.spans.some((span) => ((span.attributes ?? 0) & underlineAttributes) === underlineAttributes)).toBe(false)
  })

  test("renders line numbers beside multiline editor content", async () => {
    const sql = "select 1\nfrom users\nwhere active = 1"
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          text: sql,
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
          cursorOffset: "select 1\nfrom".length,
          text: sql,
        })}
      />,
      { height: 12, width: 80 },
    )

    const highlightedRow = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("from users"))
    const lineHighlightBg = RGBA.fromHex(editorCursorLineColors.contentBackgroundColor)

    expect(highlightedRow?.spans.some((span) => span.bg?.equals(lineHighlightBg))).toBe(true)
  })

  test("renders tree-sitter SQL highlights with base16 circus colors", async () => {
    const sql = "select count(*) from users where active = 1"
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
          text: sql,
          treeSitterGrammar: "sql",
        })}
      />,
      { height: 12, width: 80 },
    )

    await settleDeferredRender(ui, 150)

    const sqlLine = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes(sql))
    const keywordSpan = sqlLine?.spans.find((span) => span.text.toLowerCase().includes("select"))
    const functionSpan = sqlLine?.spans.find((span) => span.text.toLowerCase().includes("count"))
    const numberSpan = sqlLine?.spans.filter((span) => span.text.includes("1")).at(-1)

    expect(keywordSpan?.fg?.equals(RGBA.fromHex("#b888e2"))).toBe(true)
    expect(functionSpan?.fg?.equals(RGBA.fromHex("#639ee4"))).toBe(true)
    expect(numberSpan?.fg?.equals(RGBA.fromHex("#84b97c"))).toBe(true)
  })
})
