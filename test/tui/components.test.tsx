import { createTextAttributes } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"
import { afterEach, describe, expect, test } from "bun:test"
import { act, useEffect, useState, type ReactNode } from "react"
import type { EditorState, OpenEditorSuggestionMenuInput } from "../../src/index"
import { JsonRowView } from "../../src/tui/dataview/JsonRowView"
import {
  ResultsTable,
  RESULTS_TABLE_FOCUS_ID,
  RESULTS_TABLE_GRID_AREA_ID,
  resultsTableRowFocusId,
} from "../../src/tui/dataview/ResultsTable"
import { clampHistoryIndex, QueryHistory } from "../../src/tui/editor/QueryHistory"
import { EditorView } from "../../src/tui/editor/EditorView"
import { FocusProvider, useFocusNavigationState, useFocusTree } from "../../src/tui/focus"
import { Shortcut } from "../../src/tui/Shortcut"
import { clampTreeIndex, flattenTree, TreeView } from "../../src/tui/sidebar/TreeView"
import { KeybindProvider } from "../../src/tui/ui/keybind"
import { loadSqliteExampleErrorCase } from "../sqlite/exampleErrors"
import { makeConnection, makeQueryExecution, makeSavedQuery } from "../support"

let rendered: Awaited<ReturnType<typeof testRender>> | undefined
type RenderedUi = Awaited<ReturnType<typeof testRender>>

async function render(node: ReactNode, size = { height: 12, width: 60 }) {
  rendered = await testRender(
    <FocusProvider>
      <KeybindProvider>{node}</KeybindProvider>
    </FocusProvider>,
    size,
  )
  await act(async () => {
    await rendered?.renderOnce()
  })
  return rendered
}

async function settleDeferredRender(ui: RenderedUi, delayMs = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await ui.renderOnce()
  })
}

async function dispatchInput(ui: RenderedUi, action: () => void | Promise<void>) {
  await act(async () => {
    await action()
    await new Promise((resolve) => setTimeout(resolve, 80))
    await ui.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await ui.renderOnce()
  })
}

function focusedPathLine(ui: RenderedUi): string {
  return ui.captureCharFrame().split("\n")[0] ?? ""
}

afterEach(() => {
  rendered?.renderer.destroy()
  rendered = undefined
})

function ResultsTableHarness(props: {
  rows: object[]
  initialPath?: readonly string[]
  width?: number
}) {
  const tree = useFocusTree()
  const state = useFocusNavigationState()

  useEffect(() => {
    if (!props.initialPath) {
      return
    }

    queueMicrotask(() => {
      tree.focusPath(props.initialPath as readonly string[])
    })
  }, [props.initialPath, tree])

  return (
    <box flexDirection="column">
      <text>{state.focusedPath?.join("/") ?? "none"}</text>
      <ResultsTable rows={props.rows} width={props.width} />
    </box>
  )
}

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
  }
}

describe("TUI components", () => {
  test("renders shortcuts and only fires matching key bindings", async () => {
    const hits: string[] = []
    const ui = await render(<Shortcut keys="ctrl+x" enabled label="Execute" onKey={() => hits.push("run")} />)

    expect(ui.captureCharFrame()).toContain("^x Execute")

    await act(async () => {
      ui.mockInput.pressKey("x", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("x")
      await ui.renderOnce()
    })

    expect(hits).toEqual(["run"])
  })

  test("ignores disabled shortcuts", async () => {
    let count = 0
    const ui = await render(<Shortcut keys="ctrl+x" enabled={false} label="Execute" onKey={() => (count += 1)} />)

    await act(async () => {
      ui.mockInput.pressKey("x", { ctrl: true })
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("Execute")
    expect(count).toBe(0)
  })

  test("renders arrow shortcuts with unicode arrow symbols", async () => {
    const ui = await render(<Shortcut keys="left right up down" enabled label="Move" />)

    expect(ui.captureCharFrame()).toContain("← → ↑ ↓ Move")
  })

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

    const ui = await render(
      <Harness />,
      { height: 12, width: 80 },
    )

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

  test("renders floating invalid-query diagnostics with an underlined error span", async () => {
    const example = loadSqliteExampleErrorCase("near-from")
    const ui = await render(
      <EditorView
        autoFocus
        editor={createEditorState({
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
          text: example.sql,
        })}
      />,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()
    expect(frame).toContain("Invalid query")
    expect(frame).toContain(example.message)
    expect(frame).toContain("L1:C8-11")

    const sqlLine = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes(example.sql))
    const underlineAttributes = createTextAttributes({ underline: true })
    const highlightedSpan = sqlLine?.spans.find((span) => span.text.includes("from"))

    expect(highlightedSpan).toBeDefined()
    expect((highlightedSpan?.attributes ?? 0) & underlineAttributes).toBe(underlineAttributes)
  })

  test("filters query history and restores the selected entry", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const restored: string[] = []
    const ui = await render(
      <QueryHistory
        entries={[
          makeQueryExecution({
            connectionId: connection.id,
            id: "one",
            sql: "select * from users",
          }),
          makeQueryExecution({
            connectionId: connection.id,
            id: "two",
            sql: "select * from orders where status = 'open'",
          }),
          makeQueryExecution({
            connectionId: connection.id,
            id: "three",
            sql: "delete from users where id = 1",
            status: "cancelled",
          }),
        ]}
        connections={[connection]}
        savedQueries={[]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => undefined}
        onRestore={(entry) => restored.push(entry.kind === "history" ? entry.entry.id : entry.savedQuery.id)}
      />,
      { height: 14, width: 80 },
    )

    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("Filter")
    expect(clampHistoryIndex(3, 2)).toBe(1)
    expect(clampHistoryIndex(-1, 2)).toBe(0)

    await dispatchInput(ui, () => {
      ui.mockInput.pressKey("o")
      ui.mockInput.pressKey("r")
      ui.mockInput.pressKey("d")
    })
    await settleDeferredRender(ui, 120)

    const frame = ui.captureCharFrame()
    expect(frame).toContain("status = 'open'")
    expect(frame).not.toContain("delete from users")

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    expect(restored).toEqual(["two"])
  })

  test("finds saved queries by name before history text matches", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const restored: string[] = []
    const ui = await render(
      <QueryHistory
        entries={[
          makeQueryExecution({
            connectionId: connection.id,
            id: "history-orders",
            sql: "select * from orders",
          }),
        ]}
        connections={[connection]}
        savedQueries={[
          makeSavedQuery({
            id: "saved-orders",
            name: "OrdersBoard",
            protocol: "bunsqlite",
            text: "select count(*) from audit_log",
          }),
        ]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => undefined}
        onRestore={(entry) =>
          restored.push(entry.kind === "saved" ? `saved:${entry.savedQuery.id}` : `history:${entry.entry.id}`)}
      />,
      { height: 14, width: 80 },
    )

    await settleDeferredRender(ui)
    await dispatchInput(ui, () => {
      ui.mockInput.pressKey("o")
      ui.mockInput.pressKey("r")
      ui.mockInput.pressKey("d")
      ui.mockInput.pressKey("e")
      ui.mockInput.pressKey("r")
      ui.mockInput.pressKey("s")
    })
    await settleDeferredRender(ui, 120)

    expect(ui.captureCharFrame()).toContain("saved")

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    expect(restored).toEqual(["saved:saved-orders"])
  })

  test("toggles system queries in query history", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })

    function Harness() {
      const [showSystemQueries, setShowSystemQueries] = useState(false)

      return (
        <QueryHistory
          entries={[
            makeQueryExecution({
              connectionId: connection.id,
              id: "user-query",
              sql: "select * from users",
            }),
            makeQueryExecution({
              connectionId: connection.id,
              id: "system-query",
              initiator: "system",
              sql: "EXPLAIN select * from users",
            }),
          ]}
          connections={[connection]}
          savedQueries={[]}
          showSystemQueries={showSystemQueries}
          onToggleShowSystemQueries={() => setShowSystemQueries((current) => !current)}
          onBack={() => undefined}
          onRestore={() => undefined}
        />
      )
    }

    const ui = await render(<Harness />, { height: 14, width: 80 })

    expect(ui.captureCharFrame()).toContain("select * from users")
    expect(ui.captureCharFrame()).not.toContain("EXPLAIN select * from users")

    await dispatchInput(ui, () => ui.mockInput.pressKey("g", { ctrl: true }))

    expect(ui.captureCharFrame()).toContain("EXPLAIN select * from users")
    expect(ui.captureCharFrame()).toContain("[x] Show system queries")
  })

  test("shows the empty query history state", async () => {
    const ui = await render(
      <QueryHistory
        connections={[]}
        entries={[]}
        savedQueries={[]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => undefined}
        onRestore={() => undefined}
      />,
    )
    expect(ui.captureCharFrame()).toContain("No previous or saved queries yet.")
  })

  test("flattens tree nodes and emits initial focus", async () => {
    const focused: string[] = []
    const nodes = [
      {
        children: [{ key: "child", name: "Child" }],
        key: "root",
        name: "Root",
      },
      {
        key: "second",
        name: "Second",
      },
    ]
    const ui = await render(<TreeView nodes={nodes} onFocus={(_index: number, node) => focused.push(node.name)} />)

    expect(ui.captureCharFrame()).toContain("Root")
    expect(ui.captureCharFrame()).toContain("Child")
    expect(focused[0]).toBe("Root")
    expect(flattenTree(nodes)).toEqual([
      {
        level: 0,
        isLast: false,
        parentIsLastPath: [],
        node: { children: [{ key: "child", name: "Child" }], key: "root", name: "Root" },
        rowKey: "root",
      },
      {
        level: 1,
        isLast: true,
        parentIsLastPath: [false],
        node: { key: "child", name: "Child" },
        rowKey: "root.child",
      },
      {
        level: 0,
        isLast: true,
        parentIsLastPath: [],
        node: { key: "second", name: "Second" },
        rowKey: "second",
      },
    ])
    expect(clampTreeIndex(-1, 3)).toBe(0)
    expect(clampTreeIndex(9, 3)).toBe(2)
  })

  test("renders JSON rows", async () => {
    const ui = await render(<JsonRowView rows={[{ id: 1, name: "Ada" }]} />)

    expect(ui.captureCharFrame()).toContain('"id": 1')
    expect(ui.captureCharFrame()).toContain('"name": "Ada"')
  })

  test("focusing the table enters the first result cell", async () => {
    const ui = await render(
      <ResultsTableHarness
        initialPath={[RESULTS_TABLE_FOCUS_ID]}
        rows={[
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ]}
      />,
      { height: 8, width: 50 },
    )

    await settleDeferredRender(ui)

    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-0")
  })

  test("focusing a result row forwards focus into its first cell", async () => {
    const ui = await render(
      <ResultsTableHarness
        initialPath={[RESULTS_TABLE_FOCUS_ID, RESULTS_TABLE_GRID_AREA_ID, resultsTableRowFocusId(1)]}
        rows={[
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ]}
      />,
      { height: 8, width: 50 },
    )

    await settleDeferredRender(ui)

    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-0")
  })

  test("navigates focused result cells with arrows and hjkl", async () => {
    const ui = await render(
      <ResultsTableHarness
        initialPath={[RESULTS_TABLE_FOCUS_ID]}
        rows={[
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ]}
      />,
      { height: 8, width: 50 },
    )

    await settleDeferredRender(ui)
    await dispatchInput(ui, () => ui.mockInput.pressArrow("right"))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-1")

    await dispatchInput(ui, () => ui.mockInput.pressKey("j"))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-1")

    await dispatchInput(ui, () => ui.mockInput.pressKey("h"))

    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-0")
  })

  test("supports spreadsheet-style result navigation shortcuts", async () => {
    const ui = await render(
      <ResultsTableHarness
        initialPath={[RESULTS_TABLE_FOCUS_ID]}
        rows={[
          { id: 1, name: "Ada" },
          { id: 2, name: "Grace" },
        ]}
      />,
      { height: 8, width: 50 },
    )

    await settleDeferredRender(ui)
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-0")

    await dispatchInput(ui, () => ui.mockInput.pressTab())
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-1")

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-1")

    await dispatchInput(ui, () => ui.mockInput.pressKey("HOME"))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-0")

    await dispatchInput(ui, () => ui.mockInput.pressKey("END"))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-1")

    await dispatchInput(ui, () => ui.mockInput.pressKey("HOME", { ctrl: true }))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-0")

    await dispatchInput(ui, () => ui.mockInput.pressKey("END", { ctrl: true }))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-1")
  })

  test("measures result tables to the parent pane and keeps rows single-line", async () => {
    const ui = await render(
      <box width={24}>
        <ResultsTable
          rows={[
            { id: 1, name: "Ada Lovelace with a very long value" },
            { id: 2, name: "Grace Hopper" },
          ]}
        />
      </box>,
      { height: 8, width: 40 },
    )

    const [header, separator, firstRow, secondRow] = ui.captureCharFrame().split("\n")
    expect(header).toContain("id")
    expect(header).toContain("name")
    expect(header).not.toContain("Ada")
    expect(separator).toContain("─")
    expect(firstRow).toContain("1")
    expect(firstRow).toContain("Ada")
    expect(secondRow).toContain("2")
    expect(secondRow).toContain("Grace")
  })
})
