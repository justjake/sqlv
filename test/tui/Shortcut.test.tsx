import type { KeyEvent } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { act } from "react"
import { Shortcut } from "../../src/tui/Shortcut"
import { parseKeys, stepMatches } from "../../src/tui/ui/keybind"
import { createTuiRenderHarness } from "./testUtils"

const { render } = createTuiRenderHarness()

describe("Shortcut", () => {
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

  test("matches canonical shortcut key names against OpenTUI event names", () => {
    const step = parseKeys("esc")[0]!
    const key = { name: "escape", ctrl: false, shift: false, meta: false, option: false } as KeyEvent

    expect(stepMatches(step, key)).toBe(true)
  })
})
