import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import { useFocusNavigationState, useFocusTree } from "../../../src/tui/focus"
import { flattenTree, clampTreeIndex, TreeView } from "../../../src/tui/sidebar/TreeView"
import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, focusedPathLine, render, settleDeferredRender } = createTuiRenderHarness()

function TreeViewHarness(props: {
  initialPath: readonly string[]
  nodes: Parameters<typeof TreeView>[0]["nodes"]
  onExpand?: Parameters<typeof TreeView>[0]["onExpand"]
  onFocus?: Parameters<typeof TreeView>[0]["onFocus"]
  onSelect?: Parameters<typeof TreeView>[0]["onSelect"]
}) {
  const tree = useFocusTree()
  const state = useFocusNavigationState()

  useEffect(() => {
    queueMicrotask(() => {
      queueMicrotask(() => {
        tree.focusPath(props.initialPath)
      })
    })
  }, [props.initialPath, tree])

  return (
    <box flexDirection="column">
      <text>{`${state.focusedPath?.join("/") ?? "none"} | nav:${state.active ? "on" : "off"}`}</text>
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

    expect(focusedPathLine(ui)).toContain("sidebar-tree")
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
})
