import { describe, expect, test } from "bun:test"
import { FormLabel } from "../../src/tui/form/FormLabel"
import { TextInput } from "../../src/tui/form/TextInput"
import { createTuiRenderHarness } from "./testUtils"

const { render } = createTuiRenderHarness()

describe("TextInput", () => {
  test("fills the full input row background instead of only the typed characters", async () => {
    const ui = await render(
      <FormLabel active inputFocused name="Connection Name">
        <TextInput onInput={() => undefined} value="abc" />
      </FormLabel>,
      { height: 6, width: 30 },
    )

    const inputLine = ui.captureSpans().lines.find((line) => line.spans.map((span) => span.text).join("").includes("abc"))
    const backgroundWidth =
      inputLine?.spans
        .filter((span) => span.bg.a > 0)
        .reduce((width, span) => width + span.width, 0) ?? 0

    expect(backgroundWidth).toBeGreaterThan("abc".length)
  })
})
