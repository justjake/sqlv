import { TextAttributes } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import { useFocusNavigationState, useFocusTree } from "../../../src/tui/focus/context"
import { flattenTree, clampTreeIndex, TreeView } from "../../../src/tui/sidebar/TreeView"
import { IconProvider } from "../../../src/tui/ui/icons"
import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()
let focusedPath: readonly string[] | undefined

function TreeViewHarness(props: {
  initialPath: readonly string[]
  nodes: Parameters<typeof TreeView>[0]["nodes"]
  onExpand?: Parameters<typeof TreeView>[0]["onExpand"]
  onFocus?: Parameters<typeof TreeView>[0]["onFocus"]
  onSelect?: Parameters<typeof TreeView>[0]["onSelect"]
}) {
  const tree = useFocusTree()
  const state = useFocusNavigationState()
  focusedPath = state.focusedPath

  useEffect(() => {
    queueMicrotask(() => {
      queueMicrotask(() => {
        tree.focusPath(props.initialPath)
      })
    })
  }, [props.initialPath, tree])

  return (
    <box flexDirection="column">
      <TreeView nodes={props.nodes} onExpand={props.onExpand} onFocus={props.onFocus} onSelect={props.onSelect} />
    </box>
  )
}

describe("TreeView", () => {
  test("flattens tree nodes and emits initial focus", async () => {
    const focused: string[] = []
    const nodes = [
      {
        children: [{ key: "child", name: "Child" }],
        expanded: true,
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
        node: { children: [{ key: "child", name: "Child" }], expanded: true, key: "root", name: "Root" },
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

  test("supports multilevel expand and collapse shortcuts and selects leaves", async () => {
    const expanded: string[] = []
    const selected: string[] = []
    const nodes = [
      {
        children: [
          {
            children: [
              {
                children: [{ key: "leaf", name: "Leaf" }],
                expandable: true,
                key: "twig",
                name: "Twig",
              },
            ],
            expandable: true,
            key: "branch",
            name: "Branch",
          },
          {
            key: "sibling",
            name: "Sibling",
          },
        ],
        expandable: true,
        key: "root",
        name: "Root",
      },
    ]

    const ui = await render(
      <TreeViewHarness
        initialPath={["sidebar-tree"]}
        nodes={nodes}
        onExpand={(_index, node) => expanded.push(node.name)}
        onSelect={(_index, node) => selected.push(node.name)}
      />,
      { height: 12, width: 80 },
    )
    await settleDeferredRender(ui)

    expect(focusedPath).toEqual(["sidebar-tree", "row-0"])
    expect(ui.captureCharFrame()).toContain("Root")
    expect(ui.captureCharFrame()).not.toContain("Branch")

    await dispatchInput(ui, () => ui.mockInput.pressArrow("right"))
    await settleDeferredRender(ui)
    expect(ui.captureCharFrame()).toContain("Branch")
    expect(expanded).toEqual(["Root"])

    await dispatchInput(ui, () => ui.mockInput.pressArrow("down"))
    await dispatchInput(ui, () => ui.mockInput.pressKey(" "))
    await settleDeferredRender(ui)
    expect(ui.captureCharFrame()).toContain("Twig")
    expect(expanded).toEqual(["Root", "Branch"])
    expect(selected).toEqual([])

    await dispatchInput(ui, () => ui.mockInput.pressArrow("down"))
    await dispatchInput(ui, () => ui.mockInput.pressArrow("right"))
    await settleDeferredRender(ui)
    expect(ui.captureCharFrame()).toContain("Leaf")
    expect(expanded).toEqual(["Root", "Branch", "Twig"])

    await dispatchInput(ui, () => ui.mockInput.pressArrow("left"))
    await settleDeferredRender(ui)
    expect(ui.captureCharFrame()).not.toContain("Leaf")

    await dispatchInput(ui, () => ui.mockInput.pressArrow("down"))
    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    expect(selected).toEqual(["Sibling"])
  })

  test("supports vim-style tree navigation shortcuts", async () => {
    const nodes = [
      {
        expanded: true,
        children: [{ key: "child", name: "Child" }],
        expandable: true,
        key: "root",
        name: "Root",
      },
    ]

    const ui = await render(
      <TreeViewHarness
        initialPath={["sidebar-tree"]}
        nodes={nodes}
      />,
      { height: 10, width: 80 },
    )

    await settleDeferredRender(ui)
    expect(focusedPath).toEqual(["sidebar-tree", "row-0"])
    expect(ui.captureCharFrame()).toContain("Child")

    await dispatchInput(ui, () => ui.mockInput.pressKey("j"))
    expect(focusedPath).toEqual(["sidebar-tree", "row-1"])

    await dispatchInput(ui, () => ui.mockInput.pressKey("k"))
    expect(focusedPath).toEqual(["sidebar-tree", "row-0"])
  })

  test("renders nvim-style nested prefixes", async () => {
    const nodes = [
      {
        expanded: true,
        children: [
          {
            expanded: true,
            children: [
              {
                expanded: true,
                children: [{ key: "leaf", name: "Leaf" }],
                expandable: true,
                key: "src",
                name: "Src",
              },
              { key: "vitest", name: "vitest.config.ts" },
            ],
            expandable: true,
            key: "react",
            name: "React",
          },
          {
            expandable: true,
            key: "solid",
            name: "Solid",
          },
        ],
        expandable: true,
        key: "root",
        name: "Root",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 8, width: 40 },
    )

    const [rootLine, reactLine, srcLine, leafLine, vitestLine, solidLine] = ui.captureCharFrame().split("\n")
    expect(rootLine?.startsWith("  Root")).toBe(true)
    expect(reactLine?.startsWith("    React")).toBe(true)
    expect(srcLine?.startsWith("  │   Src")).toBe(true)
    expect(leafLine?.startsWith("  │ │ └ * Leaf")).toBe(true)
    expect(vitestLine?.startsWith("  │ └ * vitest.config.ts")).toBe(true)
    expect(solidLine?.startsWith("    Solid")).toBe(true)
  })

  test("keeps tree rows single-line when labels are long", async () => {
    const nodes = [
      {
        expanded: true,
        children: [{ key: "child", name: "A child with another longish label" }],
        expandable: true,
        key: "root",
        name: "A root with a fairly long label",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 6, width: 30 },
    )

    const [rootLine, childLine, thirdLine] = ui.captureCharFrame().split("\n")
    expect(rootLine?.startsWith("  ")).toBe(true)
    expect(rootLine).toContain("")
    expect(childLine?.startsWith("  └ * ")).toBe(true)
    expect(rootLine).toContain("A root")
    expect(childLine).toContain("A child")
    expect(thirdLine?.trim()).toBe("")
  })

  test("renders accessories dimmed at the right edge without changing the main label", async () => {
    const nodes = [
      {
        accessory: "bunsqlite",
        expandable: true,
        key: "root",
        name: "Local DB",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 30 },
    )

    const [rootLine] = ui.captureCharFrame().split("\n")
    expect(rootLine?.startsWith("  Local DB")).toBe(true)
    expect(rootLine?.endsWith("bunsqlite")).toBe(true)
    expect(rootLine).not.toContain("(bunsqlite)")
  })

  test("truncates right-side accessories before truncating the main label", async () => {
    const nodes = [
      {
        accessory: "bunsqlite",
        expandable: true,
        key: "root",
        name: "LabelPriority",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 17 },
    )

    const [rootLine] = ui.captureCharFrame().split("\n")
    expect(rootLine?.startsWith("  LabelPriority")).toBe(true)
    expect(rootLine).not.toContain("bunsqlite")
  })

  test("renders accessory icons with a separator when requested", async () => {
    const nodes: Parameters<typeof TreeView>[0]["nodes"] = [
      {
        accessory: "main",
        accessoryIcon: "database",
        accessorySeparator: true,
        expandable: true,
        key: "root",
        name: "Mem",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 30 },
    )

    const [rootLine] = ui.captureCharFrame().split("\n")
    expect(rootLine?.startsWith("  Mem")).toBe(true)
    expect(rootLine).toContain("|")
    expect(rootLine).toContain("main")
  })

  test("renders inline accessory icons next to the main label and keeps the icon accent color", async () => {
    const nodes: Parameters<typeof TreeView>[0]["nodes"] = [
      {
        accessory: "bunsqlite",
        expandable: true,
        inlineAccessory: "main",
        inlineAccessoryIcon: "database",
        inlineAccessorySeparator: true,
        key: "root",
        name: "Mem",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 40 },
    )

    const [rootLine] = ui.captureCharFrame().split("\n")
    const rootSpanLine = ui.captureSpans().lines[0]
    const folderIconSpan = rootSpanLine?.spans.find((span) => span.text.includes(""))
    const databaseIconSpan = rootSpanLine?.spans.find((span) => span.text.includes("󰆼"))

    expect(rootLine?.startsWith("  Mem 󰆼 main")).toBe(true)
    expect(rootLine?.trimEnd().endsWith("bunsqlite")).toBe(true)
    expect(folderIconSpan).toBeDefined()
    expect(databaseIconSpan).toBeDefined()
    expect(databaseIconSpan?.fg.equals(folderIconSpan!.fg)).toBe(true)
  })

  test("dims automatic rows while leaving regular rows undimmed", async () => {
    const nodes = [
      {
        expanded: true,
        children: [
          { accessory: "idx", key: "manual", kind: "index", name: "users_name_idx" },
          { accessory: "idx", automatic: true, key: "auto", kind: "index", name: "sqlite_autoindex_users_1" },
        ],
        expandable: true,
        key: "root",
        name: "users",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 5, width: 60 },
    )

    const manualLine = ui.captureSpans().lines.find((line) =>
      line.spans.map((span) => span.text).join("").includes("users_name_idx"),
    )
    const automaticLine = ui.captureSpans().lines.find((line) =>
      line.spans.map((span) => span.text).join("").includes("sqlite_autoindex_users_1"),
    )
    const manualLabelSpan = manualLine?.spans.find((span) => span.text.includes("users_name_idx"))
    const automaticLabelSpan = automaticLine?.spans.find((span) => span.text.includes("sqlite_autoindex_users_1"))

    expect(((manualLabelSpan?.attributes ?? 0) & TextAttributes.DIM) === TextAttributes.DIM).toBe(false)
    expect((automaticLabelSpan?.attributes ?? 0) & TextAttributes.DIM).toBe(TextAttributes.DIM)
  })

  test("renders the empty-folder icon when an empty folder is open", async () => {
    const nodes = [
      {
        children: [],
        expandable: true,
        expanded: true,
        key: "open-empty",
        name: "open-empty",
      },
      {
        children: [],
        expandable: true,
        key: "closed-empty",
        name: "closed-empty",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 40 },
    )

    const [openLine, closedLine] = ui.captureCharFrame().split("\n")
    expect(openLine?.startsWith(" 󰉖 open-empty")).toBe(true)
    expect(closedLine?.startsWith("  closed-empty")).toBe(true)
  })

  test("renders index nodes with a semantic index icon", async () => {
    const nodes = [
      {
        expanded: true,
        children: [{ key: "email_idx", kind: "index", name: "email_idx" }],
        expandable: true,
        key: "root",
        name: "Root",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 40 },
    )

    const [, childLine] = ui.captureCharFrame().split("\n")
    expect(childLine?.startsWith("  └ ⌗ email_idx")).toBe(true)
  })

  test("keeps the semantic table icon when a table row is expandable", async () => {
    const nodes = [
      {
        expanded: true,
        children: [{ key: "email_idx", kind: "index", name: "email_idx" }],
        kind: "table",
        key: "users",
        name: "users",
      },
    ]

    const ui = await render(
      <TreeView nodes={nodes} />,
      { height: 4, width: 40 },
    )

    const [tableLine, childLine] = ui.captureCharFrame().split("\n")
    expect(tableLine?.startsWith(" 󰓫 users")).toBe(true)
    expect(childLine?.startsWith("  └ ⌗ email_idx")).toBe(true)
  })

  test("renders unicode fallback icons when wrapped in the unicode icon provider", async () => {
    const nodes = [
      {
        expanded: true,
        children: [{ key: "table", kind: "table", name: "users" }],
        expandable: true,
        key: "root",
        name: "Root",
      },
    ]

    const ui = await render(
      <IconProvider style="unicode">
        <TreeView nodes={nodes} />
      </IconProvider>,
      { height: 4, width: 40 },
    )

    const [rootLine, childLine] = ui.captureCharFrame().split("\n")
    expect(rootLine?.startsWith("▾ ◫ Root")).toBe(true)
    expect(childLine?.startsWith("  └ ▦ users")).toBe(true)
  })
})
