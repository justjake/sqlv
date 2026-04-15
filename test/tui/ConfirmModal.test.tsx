import { RGBA } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { ConfirmModal } from "../../src/tui/ui/ConfirmModal"
import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

describe("ConfirmModal", () => {
  test("renders the non-default hotkey letters in the focus accent color", async () => {
    const ui = await render(
      <ConfirmModal onNo={() => undefined} onYes={() => undefined} title="Delete?">
        Body
      </ConfirmModal>,
      { height: 14, width: 50 },
    )

    await settleDeferredRender(ui)

    const buttonLine = ui.captureSpans().lines.find((line) => {
      const text = line.spans.map((span) => span.text).join("")
      return text.includes("no") && text.includes("Yes")
    })
    const noHotkey = buttonLine?.spans.find((span) => span.text === "n")
    const yesHotkey = buttonLine?.spans.find((span) => span.text === "Y")

    expect(noHotkey?.fg.equals(RGBA.fromHex("#639ee4"))).toBe(true)
    expect(yesHotkey?.fg.equals(RGBA.fromHex("#639ee4"))).toBe(true)
  })

  test("fills the default action button box with the focus background color", async () => {
    const ui = await render(
      <ConfirmModal default="yes" onNo={() => undefined} onYes={() => undefined}>
        Body
      </ConfirmModal>,
      { height: 12, width: 50 },
    )

    await settleDeferredRender(ui)

    const buttonLine = ui.captureSpans().lines.find((line) => {
      const text = line.spans.map((span) => span.text).join("")
      return text.includes("Yes")
    })
    const focusBackgroundWidth =
      buttonLine?.spans.filter((span) => span.bg.equals(RGBA.fromHex("#639ee4"))).reduce((sum, span) => sum + span.width, 0) ?? 0

    expect(focusBackgroundWidth).toBeGreaterThan("Yes".length)
  })

  test("routes enter, y, n, and escape to the expected actions", async () => {
    const hits: string[] = []
    const ui = await render(
      <ConfirmModal default="yes" onNo={() => hits.push("no")} onYes={() => hits.push("yes")}>
        Body
      </ConfirmModal>,
      { height: 12, width: 50 },
    )

    await settleDeferredRender(ui)

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    await dispatchInput(ui, () => ui.mockInput.pressKey("n"))
    await dispatchInput(ui, () => ui.mockInput.pressKey("y"))
    await dispatchInput(ui, () => ui.mockInput.pressEscape())

    expect(hits).toEqual(["yes", "no", "yes", "no"])
  })

  test("routes command aliases to the expected confirm actions", async () => {
    const hits: string[] = []
    const ui = await render(
      <ConfirmModal onNo={() => hits.push("no")} onYes={() => hits.push("yes")}>
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
