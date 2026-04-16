import { describe, expect, test } from "bun:test"
import { useState } from "react"
import { TextField } from "../../src/tui/form"
import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, render } = createTuiRenderHarness()

describe("TextField", () => {
  test("fills the full input row background instead of only the typed characters", async () => {
    const ui = await render(
      <TextField autoFocus focusableId="connection-name" label="Connection Name" onChange={() => undefined} value="abc" />,
      { height: 6, width: 30 },
    )

    const inputLine = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("abc"))
    const backgroundWidth =
      inputLine?.spans
        .filter((span) => span.bg.a > 0)
        .reduce((width, span) => width + span.width, 0) ?? 0

    expect(backgroundWidth).toBeGreaterThan("abc".length)
  })

  test("ignores typed input while disabled", async () => {
    const values: string[] = []
    const ui = await render(
      <TextField
        autoFocus
        disabled
        focusableId="connection-name"
        label="Connection Name"
        onChange={(value) => values.push(value)}
        value="abc"
      />,
      { height: 6, width: 30 },
    )

    await dispatchInput(ui, () => ui.mockInput.typeText("z"))

    expect(values).toEqual([])
    expect(ui.captureCharFrame()).toContain("abc")
    expect(ui.captureCharFrame()).not.toContain("abcz")
  })

  test("does not treat vim nav aliases as field navigation while editing text", async () => {
    function Harness() {
      const [value, setValue] = useState("")

      return <TextField autoFocus focusableId="connection-name" label="Connection Name" onChange={setValue} value={value} />
    }

    const ui = await render(<Harness />, { height: 6, width: 30 })

    await dispatchInput(ui, () => ui.mockInput.typeText("jk"))

    expect(ui.captureCharFrame()).toContain("jk")
  })
})
