import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { act } from "react"

import { CheckboxField } from "./CheckboxField"

import { createTuiRenderHarness } from "../testUtils"

const { render } = createTuiRenderHarness()

describe("CheckboxField", () => {
  test("fills the full checkbox row background and colors the indicator when focused", async () => {
    const ui = await render(
      <CheckboxField
        autoFocus
        checked={false}
        focusableId="readonly"
        hint="space toggle"
        label="Readonly"
        onChange={() => undefined}
      />,
      { height: 6, width: 40 },
    )

    const checkboxLine = ui.captureSpans().lines.find((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .includes("Disabled"),
    )
    const backgroundWidth =
      checkboxLine?.spans.filter((span) => span.bg.a > 0).reduce((width, span) => width + span.width, 0) ?? 0
    const indicator = checkboxLine?.spans.find((span) => span.text === "○")

    expect(backgroundWidth).toBeGreaterThan("○ Disabled".length)
    expect(indicator?.fg.equals(RGBA.fromHex("#639ee4"))).toBe(true)
  })

  test("toggles from the keyboard when the field input is focused", async () => {
    const values: boolean[] = []
    const ui = await render(
      <CheckboxField
        autoFocus
        checked={false}
        focusableId="readonly"
        label="Readonly"
        onChange={(value) => values.push(value)}
      />,
      { height: 6, width: 40 },
    )

    await act(async () => {
      ui.mockInput.pressKey(" ")
      await ui.renderOnce()
    })

    expect(values).toEqual([true])
  })

  test("does not toggle while disabled", async () => {
    const values: boolean[] = []
    const ui = await render(
      <CheckboxField
        autoFocus
        checked={false}
        disabled
        focusableId="readonly"
        hint="space toggle"
        label="Readonly"
        onChange={(value) => values.push(value)}
      />,
      { height: 6, width: 40 },
    )

    await act(async () => {
      ui.mockInput.pressKey(" ")
      await ui.renderOnce()
    })

    expect(values).toEqual([])
    expect(ui.captureCharFrame()).not.toContain("space toggle")
  })
})
