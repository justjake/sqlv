import { testRender } from "@opentui/react/test-utils"
import { afterEach, describe, expect, test } from "bun:test"
import { act, type ReactNode } from "react"
import { JsonRowView } from "../../src/tui/dataview/JsonRowView"
import { ResultsTable } from "../../src/tui/dataview/ResultsTable"
import { clampHistoryIndex, QueryHistory } from "../../src/tui/editor/QueryHistory"
import { EditorView } from "../../src/tui/editor/EditorView"
import { FocusProvider } from "../../src/tui/focus"
import { Shortcut } from "../../src/tui/Shortcut"
import { clampTreeIndex, flattenTree, TreeView } from "../../src/tui/sidebar/TreeView"
import { KeybindProvider } from "../../src/tui/ui/keybind"
import { makeQueryExecution } from "../support"

let rendered: Awaited<ReturnType<typeof testRender>> | undefined

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

afterEach(() => {
  rendered?.renderer.destroy()
  rendered = undefined
})

function createHistoryEntry(id: string, sql: string) {
  return makeQueryExecution({
    id,
    sql,
  })
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

  test("edits, executes, clears, and opens history from the editor", async () => {
    const changes: string[] = []
    const executions: string[] = []
    let historyCount = 0
    const ui = await render(
      <EditorView
        autoFocus
        text=""
        onExecute={(sql: string) => executions.push(sql)}
        onHistory={() => (historyCount += 1)}
        onTextChange={(sql: string) => changes.push(sql)}
      />,
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
    })

    expect(ui.captureCharFrame()).toContain("History")
    expect(changes).toContain("select 1")
    expect(changes.at(-1)).toBe("")
    expect(executions).toEqual(["select 1"])
    expect(historyCount).toBe(1)
  })

  test("renders query history and clamps selection indexes", async () => {
    const ui = await render(
      <QueryHistory
        entries={[createHistoryEntry("one", "select 1"), createHistoryEntry("two", "select 2")]}
        connections={[]}
        onBack={() => undefined}
        onRestore={() => undefined}
      />,
      { height: 12, width: 80 },
    )

    expect(ui.captureCharFrame()).toContain("select 1")
    expect(ui.captureCharFrame()).toContain("select 2")
    expect(clampHistoryIndex(3, 2)).toBe(1)
    expect(clampHistoryIndex(-1, 2)).toBe(0)
  })

  test("shows the empty query history state", async () => {
    const ui = await render(<QueryHistory connections={[]} entries={[]} onBack={() => undefined} onRestore={() => undefined} />)
    expect(ui.captureCharFrame()).toContain("No query history yet.")
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
