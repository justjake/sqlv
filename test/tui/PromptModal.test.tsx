import { describe, expect, test } from "bun:test"
import { PromptModal } from "../../src/tui/ui/PromptModal"
import { Text } from "../../src/tui/ui/Text"
import { createTuiRenderHarness } from "./testUtils"

const { render, settleDeferredRender } = createTuiRenderHarness()

describe("PromptModal", () => {
  test("auto-sizes its frame without borders while staying vertically centered inside the three-cell screen inset", async () => {
    const ui = await render(
      <PromptModal
        focusableId="prompt-modal"
        footer={<Text>Footer</Text>}
        title="Title"
      >
        Hi
      </PromptModal>,
      {
        height: 20,
        width: 40,
      },
    )

    await settleDeferredRender(ui)

    const frame = ui.captureCharFrame()
    const lines = frame.split("\n")
    const visibleLineIndexes = lines.flatMap((line, index) => (/\S/.test(line) ? [index] : []))
    const visibleWidths = lines.flatMap((line) => {
      const segment = line.match(/\S(?:.*\S)?/)?.[0]
      return segment ? [segment.length] : []
    })
    const topMargin = visibleLineIndexes[0] ?? 0
    const bottomMargin = lines.length - 1 - (visibleLineIndexes.at(-1) ?? 0)

    expect(topMargin).toBeGreaterThanOrEqual(3)
    expect(bottomMargin).toBeGreaterThanOrEqual(3)
    expect(Math.abs(topMargin - bottomMargin)).toBeLessThanOrEqual(2)
    expect(Math.max(...visibleWidths)).toBeLessThan(20)
    expect(frame).not.toMatch(/[┌┐└┘│─]/)
  })
})
