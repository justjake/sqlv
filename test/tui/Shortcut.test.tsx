import type { KeyEvent } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { act, useEffect } from "react"
import { Focusable, useFocusNavigationState, useFocusTree } from "../../src/tui/focus"
import { Shortcut } from "../../src/tui/Shortcut"
import { normalizeShortcutKeyName } from "../../src/tui/ui/shortcutKeys"
import {
  labelizeShortcutInput,
  parseKeys,
  stepMatches,
  translateNavKey,
  useNavKeys,
  type AliasedByNavKey,
} from "../../src/tui/ui/keybind"
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

function GlobalShortcutHarness(props: { onHit: (value: string) => void }) {
  const tree = useFocusTree()

  useEffect(() => {
    queueMicrotask(() => {
      tree.focusPath(["other"])
    })
  }, [tree])

  return (
    <box flexDirection="column">
      <Focusable focusableId="scoped">
        <Shortcut global keys="ctrl+n" enabled label="Global" onKey={() => props.onHit("global")} />
      </Focusable>
      <Focusable focusable focusableId="other">
        <text>Other</text>
      </Focusable>
    </box>
  )
}

function NavKeysRegistrar(props: {
  onHit: (value: string) => void
  prevent?: readonly AliasedByNavKey[]
}) {
  useNavKeys({
    activate: () => props.onHit("activate"),
    "ctrl+up": () => props.onHit("ctrl+up"),
    down: () => props.onHit("down"),
    esc: () => props.onHit("esc"),
    left: () => props.onHit("left"),
    prevent: props.prevent,
    right: () => props.onHit("right"),
    up: () => props.onHit("up"),
  })

  return null
}

function NavKeysHarness(props: {
  onHit: (value: string) => void
  prevent?: readonly AliasedByNavKey[]
}) {
  const tree = useFocusTree()

  useEffect(() => {
    queueMicrotask(() => {
      tree.focusPath(["nav"])
    })
  }, [tree])

  return (
    <Focusable focusable focusableId="nav">
      <NavKeysRegistrar onHit={props.onHit} prevent={props.prevent} />
      <text>Nav</text>
    </Focusable>
  )
}

describe("Shortcut", () => {
  test("renders shortcuts and only fires matching key bindings", async () => {
    const hits: string[] = []
    const ui = await render(<Shortcut keys="ctrl+x" enabled label="Execute" onKey={() => hits.push("run")} />)

    expect(ui.captureCharFrame()).toContain("⌃x Execute")

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
    const ui = await render(<Shortcut keys={{ or: ["up", "k"] }} enabled label="Prev" onKey={() => hits.push("prev")} />)

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

  test("treats array keys as chord chains", async () => {
    const hits: string[] = []
    const ui = await render(<Shortcut keys={["ctrl+x", "d"]} enabled label="Chord" onKey={() => hits.push("chord")} />)

    expect(ui.captureCharFrame()).toContain("⌃x d Chord")

    await act(async () => {
      ui.mockInput.pressKey("x", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("d")
      await ui.renderOnce()
    })

    expect(hits).toEqual(["chord"])
  })

  test("allows scoped shortcuts to opt into global fallback routing", async () => {
    const hits: string[] = []
    const ui = await render(<GlobalShortcutHarness onHit={(value) => hits.push(value)} />)

    await settleDeferredRender(ui)

    await act(async () => {
      ui.mockInput.pressKey("n", { ctrl: true })
      await ui.renderOnce()
    })

    expect(hits).toEqual(["global"])
  })

  test("useNavKeys wires arrows, vim aliases, activate, and escape", async () => {
    const hits: string[] = []
    const ui = await render(<NavKeysHarness onHit={(value) => hits.push(value)} />)

    await settleDeferredRender(ui)

    await act(async () => {
      ui.mockInput.pressArrow("up")
      await ui.renderOnce()
      ui.mockInput.pressKey("j")
      await ui.renderOnce()
      ui.mockInput.pressKey("h")
      await ui.renderOnce()
      ui.mockInput.pressKey("l")
      await ui.renderOnce()
      ui.mockInput.pressEnter()
      await ui.renderOnce()
      ui.mockInput.pressKey(" ")
      await ui.renderOnce()
    })

    await dispatchInput(ui, () => ui.mockInput.pressEscape())

    expect(hits).toEqual(["up", "down", "left", "right", "activate", "activate", "esc"])
  })

  test("translateNavKey expands modifiers through nav aliases", () => {
    expect(translateNavKey("up")).toEqual({ or: ["up", "k"] })
    expect(translateNavKey("ctrl+up")).toEqual({ or: ["ctrl+up", "ctrl+k"] })
    expect(translateNavKey("activate")).toEqual({ or: ["space", "return"] })
  })

  test("useNavKeys routes modifier aliases through the same nav handler", async () => {
    const hits: string[] = []
    const ui = await render(<NavKeysHarness onHit={(value) => hits.push(value)} />)

    await settleDeferredRender(ui)

    await act(async () => {
      ui.mockInput.pressArrow("up", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("k", { ctrl: true })
      await ui.renderOnce()
    })

    expect(hits).toEqual(["ctrl+up", "ctrl+up"])
  })

  test("useNavKeys can suppress selected aliases", async () => {
    const hits: string[] = []
    const ui = await render(<NavKeysHarness onHit={(value) => hits.push(value)} prevent={["h", "ctrl+k"]} />)

    await settleDeferredRender(ui)

    await act(async () => {
      ui.mockInput.pressKey("h")
      await ui.renderOnce()
      ui.mockInput.pressKey("j")
      await ui.renderOnce()
      ui.mockInput.pressKey("k", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressArrow("up", { ctrl: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("l")
      await ui.renderOnce()
      ui.mockInput.pressArrow("left")
      await ui.renderOnce()
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })

    expect(hits).toEqual(["down", "ctrl+up", "right", "left", "right"])
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

  test("matches collapsed ctrl punctuation events from terminals", () => {
    const step = parseKeys("ctrl+,")[0]!
    const key = { name: "\u001c", ctrl: false, shift: false, meta: false, option: false } as KeyEvent

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

  test("matches command and super shortcuts against OpenTUI super events", () => {
    const commandStep = parseKeys("command+f")[0]!
    const superStep = parseKeys("super+f")[0]!
    const key = { name: "f", ctrl: false, shift: false, meta: false, option: false, super: true } as KeyEvent

    expect(stepMatches(commandStep, key)).toBe(true)
    expect(stepMatches(superStep, key)).toBe(true)
  })

  test("renders option shortcuts without duplicating the alt label", async () => {
    const ui = await render(<Shortcut keys="option+f" enabled label="Format" />)

    expect(ui.captureCharFrame()).toContain("⌥f Format")
    expect(ui.captureCharFrame()).not.toContain("alt+⌥f")
  })

  test("renders combined modifiers in macOS display order", async () => {
    const ui = await render(<Shortcut keys="ctrl+option+shift+f" enabled label="Format" />)

    expect(ui.captureCharFrame()).toContain("⌃⌥⇧f Format")
  })

  test("renders and dispatches command shortcuts via OpenTUI super", async () => {
    const hits: string[] = []
    const ui = await render(<Shortcut keys="command+f" enabled label="Format" onKey={() => hits.push("format")} />, {
      kittyKeyboard: true,
    })

    expect(ui.captureCharFrame()).toContain("⌘f Format")

    await act(async () => {
      ui.mockInput.pressKey("f", { super: true })
      await ui.renderOnce()
      ui.mockInput.pressKey("f")
      await ui.renderOnce()
    })

    expect(hits).toEqual(["format"])
  })

  test("collapses ctrl and command alternatives for display by platform", () => {
    expect(labelizeShortcutInput({ or: ["command+return", "ctrl+return"] }, "darwin")).toBe("⌘⮐")
    expect(labelizeShortcutInput({ or: ["command+return", "ctrl+return"] }, "linux")).toBe("⌃⮐")
    expect(labelizeShortcutInput({ or: ["option+home", "command+home", "ctrl+home"] }, "darwin")).toBe(
      "⌥home / ⌘home",
    )
    expect(labelizeShortcutInput({ or: ["option+home", "command+home", "ctrl+home"] }, "linux")).toBe(
      "⌥home / ⌃home",
    )
  })

  test("renders platform-preferred ctrl and command alternatives once", async () => {
    const ui = await render(<Shortcut keys={{ or: ["command+return", "ctrl+return"] }} enabled label="Execute" />, {
      kittyKeyboard: true,
    })

    expect(ui.captureCharFrame()).toContain(`${process.platform === "darwin" ? "⌘⮐" : "⌃⮐"} Execute`)
    expect(ui.captureCharFrame()).not.toContain(" / ")
  })

  test("renders return using the mac-style symbol", async () => {
    const ui = await render(<Shortcut keys="return" enabled label="Save" />)

    expect(ui.captureCharFrame()).toContain("⮐ Save")
  })

  test("renders plus shortcuts using the plus symbol", async () => {
    const ui = await render(<Shortcut keys="ctrl+plus" enabled label="Zoom" />)

    expect(ui.captureCharFrame()).toContain("⌃+ Zoom")
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
