import { RGBA } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { ConfirmModal } from "../../src/apps/tui/ui/ConfirmModal"
import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

describe("ConfirmModal", () => {
  test("renders derived plain-text label hotkeys in the focus accent color", async () => {
    const ui = await render(
      <ConfirmModal no="Close" onNo={() => undefined} onYes={() => undefined} title="Delete?" yes="Do">
        Body
      </ConfirmModal>,
      { height: 14, width: 50 },
    )

    await settleDeferredRender(ui)

    const accent = RGBA.fromHex("#639ee4")
    const accentGlyphs = ui
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.fg?.equals(accent))
      .map((span) => span.text)

    expect(accentGlyphs).toContain("C")
    expect(accentGlyphs).toContain("D")
  })

  test("fills the default action half-width footer across all three footer rows", async () => {
    const ui = await render(
      <ConfirmModal default="yes" no="Cancel" onNo={() => undefined} onYes={() => undefined} yes="Delete">
        Body
      </ConfirmModal>,
      { height: 12, width: 50 },
    )

    await settleDeferredRender(ui)

    const footerLines = ui
      .captureSpans()
      .lines.filter((line) => line.spans.some((span) => span.bg.equals(RGBA.fromHex("#639ee4"))))
    const focusBackgroundWidths = footerLines.map((line) =>
      line.spans.filter((span) => span.bg.equals(RGBA.fromHex("#639ee4"))).reduce((sum, span) => sum + span.width, 0),
    )

    expect(footerLines).toHaveLength(3)
    expect(new Set(focusBackgroundWidths).size).toBe(1)
    expect(focusBackgroundWidths[0]).toBeGreaterThan(0)
  })

  test("routes enter, derived label hotkeys, and escape to the expected actions", async () => {
    const hits: string[] = []
    const ui = await render(
      <ConfirmModal default="yes" no="Cancel" onNo={() => hits.push("no")} onYes={() => hits.push("yes")} yes="Delete">
        Body
      </ConfirmModal>,
      { height: 12, width: 50 },
    )

    await settleDeferredRender(ui)

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    await dispatchInput(ui, () => ui.mockInput.pressKey("c"))
    await dispatchInput(ui, () => ui.mockInput.pressKey("d"))
    await dispatchInput(ui, () => ui.mockInput.pressEscape())

    expect(hits).toEqual(["yes", "no", "yes", "no"])
  })

  test("routes command aliases to the expected confirm actions", async () => {
    const hits: string[] = []
    const ui = await render(
      <ConfirmModal no="Cancel" onNo={() => hits.push("no")} onYes={() => hits.push("yes")} yes="Delete">
        Body
      </ConfirmModal>,
      { height: 12, kittyKeyboard: true, width: 50 },
    )

    await settleDeferredRender(ui)

    await dispatchInput(ui, () => ui.mockInput.pressEnter({ super: true }))
    await dispatchInput(ui, () => ui.mockInput.pressKey(".", { super: true }))

    expect(hits).toEqual(["yes", "no"])
  })
})
