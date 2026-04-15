import type { KeyEvent } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { act, useEffect } from "react"
import { Focusable, useFocusNavigationState, useFocusTree } from "../../src/tui/focus"
import { Shortcut } from "../../src/tui/Shortcut"
import { normalizeShortcutKeyName } from "../../src/tui/ui/shortcutKeys"
import { parseKeys, stepMatches } from "../../src/tui/ui/keybind"
import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, focusedPathLine, render, settleDeferredRender } = createTuiRenderHarness()

function FocusNavigationHarness() {
  const tree = useFocusTree()
  const state = useFocusNavigationState()

  useEffect(() => {
    queueMicrotask(() => {
      tree.focusPath(["root", "top-left"])
    })
  }, [tree])

  return (
    <box flexDirection="column">
      <text>{`focused:${state.focusedPath?.join("/") ?? "none"} highlighted:${state.highlightedPath?.join("/") ?? "none"} nav:${state.active ? "on" : "off"}`}</text>
      <Focusable focusableId="root" flexDirection="column">
        <box flexDirection="row">
          <Focusable focusable focusableId="top-left">
            <text>TL</text>
          </Focusable>
          <Focusable focusable focusableId="top-right">
            <text>TR</text>
          </Focusable>
        </box>
        <box flexDirection="row">
          <Focusable focusable focusableId="bottom-left">
            <text>BL</text>
          </Focusable>
          <Focusable focusable focusableId="bottom-right">
            <text>BR</text>
          </Focusable>
        </box>
      </Focusable>
    </box>
  )
}

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

  test("supports alternative shortcut sequences", async () => {
    const hits: string[] = []
    const ui = await render(<Shortcut keys={["up", "k"]} enabled label="Prev" onKey={() => hits.push("prev")} />)

    expect(ui.captureCharFrame()).toContain("↑ / k Prev")

    await act(async () => {
      ui.mockInput.pressArrow("up")
      await ui.renderOnce()
      ui.mockInput.pressKey("k")
      await ui.renderOnce()
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })

    expect(hits).toEqual(["prev", "prev"])
  })

  test("matches canonical shortcut key names against OpenTUI event names", () => {
    const step = parseKeys("esc")[0]!
    const key = { name: "escape", ctrl: false, shift: false, meta: false, option: false } as KeyEvent

    expect(stepMatches(step, key)).toBe(true)
  })

  test("normalizes the plus alias to the literal plus key", () => {
    const step = parseKeys("ctrl+plus")[0]!
    const key = { name: "+", ctrl: true, shift: false, meta: false, option: false } as KeyEvent

    expect(step.name).toBe("plus")
    expect(normalizeShortcutKeyName(step.name)).toBe("+")
    expect(stepMatches(step, key)).toBe(true)
  })

  test("matches alt shortcuts when the terminal also reports the option modifier bit", () => {
    const step = parseKeys("shift+alt+f")[0]!
    const key = { name: "f", ctrl: false, shift: true, meta: true, option: true } as KeyEvent

    expect(stepMatches(step, key)).toBe(true)
  })

  test("matches option shortcuts when the terminal only reports meta", () => {
    const step = parseKeys("option+f")[0]!
    const key = { name: "f", ctrl: false, shift: false, meta: true, option: false } as KeyEvent

    expect(stepMatches(step, key)).toBe(true)
  })

  test("renders option shortcuts without duplicating the alt label", async () => {
    const ui = await render(<Shortcut keys="option+f" enabled label="Format" />)

    expect(ui.captureCharFrame()).toContain("⌥f Format")
    expect(ui.captureCharFrame()).not.toContain("alt+⌥f")
  })

  test("renders plus shortcuts using the plus symbol", async () => {
    const ui = await render(<Shortcut keys="ctrl+plus" enabled label="Zoom" />)

    expect(ui.captureCharFrame()).toContain("^+ Zoom")
  })

  test("routes hjkl through focus navigation mode", async () => {
    const ui = await render(<FocusNavigationHarness />, { height: 8, width: 80 })

    await settleDeferredRender(ui)
    expect(focusedPathLine(ui)).toContain("focused:root/top-left highlighted:root/top-left nav:off")

    await dispatchInput(ui, () => ui.mockInput.pressEscape())
    expect(focusedPathLine(ui)).toContain("highlighted:root/top-left nav:on")

    await dispatchInput(ui, () => ui.mockInput.pressKey("l"))
    expect(focusedPathLine(ui)).toContain("highlighted:root/top-right nav:on")

    await dispatchInput(ui, () => ui.mockInput.pressKey("j"))
    expect(focusedPathLine(ui)).toContain("highlighted:root/bottom-right nav:on")

    await dispatchInput(ui, () => ui.mockInput.pressKey("h"))
    expect(focusedPathLine(ui)).toContain("highlighted:root/bottom-left nav:on")

    await dispatchInput(ui, () => ui.mockInput.pressKey("k"))
    expect(focusedPathLine(ui)).toContain("highlighted:root/top-left nav:on")
  })
})
