import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import {
  ResultsTable,
  RESULTS_TABLE_FOCUS_ID,
  RESULTS_TABLE_GRID_AREA_ID,
  resultsTableRowFocusId,
} from "../../../src/tui/dataview/ResultsTable"
import { useFocusNavigationState, useFocusTree } from "../../../src/tui/focus"
import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, focusedPathLine, render, settleDeferredRender } = createTuiRenderHarness()

function ResultsTableHarness(props: { rows: object[]; initialPath?: readonly string[]; width?: number }) {
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

describe("ResultsTable", () => {
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

  test("supports modifier nav aliases alongside edge jumps in the results grid", async () => {
    const ui = await render(
      <ResultsTableHarness
        initialPath={[RESULTS_TABLE_FOCUS_ID]}
        rows={[
          { id: 1, name: "Ada", city: "London" },
          { id: 2, name: "Grace", city: "New York" },
        ]}
      />,
      { height: 8, width: 60 },
    )

    await settleDeferredRender(ui)
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-0")

    await dispatchInput(ui, () => ui.mockInput.pressKey("l", { ctrl: true }))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-2")

    await dispatchInput(ui, () => ui.mockInput.pressArrow("down", { ctrl: true }))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-1/cell-2")

    await dispatchInput(ui, () => ui.mockInput.pressKey("k", { ctrl: true }))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-2")

    await dispatchInput(ui, () => ui.mockInput.pressArrow("left", { ctrl: true }))
    expect(focusedPathLine(ui)).toContain("results-table/grid/row-0/cell-0")
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

    const [header, firstRow, secondRow] = ui.captureCharFrame().split("\n")
    expect(header).toContain("id")
    expect(header).toContain("name")
    expect(header).not.toContain("Ada")
    expect(firstRow).toContain("1")
    expect(firstRow).toContain("Ada")
    expect(secondRow).toContain("2")
    expect(secondRow).toContain("Grace")
  })
})
