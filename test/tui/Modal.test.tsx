import { describe, expect, test } from "bun:test"
import { Modal } from "../../src/tui/ui/Modal"
import { Text } from "../../src/tui/ui/Text"
import { createTuiRenderHarness } from "./testUtils"

const { render } = createTuiRenderHarness()

describe("Modal", () => {
  test("renders the bottom-right slot without shrinking the body layout", async () => {
    const ui = await render(
      <Modal bottomRight={<Text>Save</Text>} height={5} width={20}>
        <box flexDirection="column">
          <Text>A</Text>
          <Text>B</Text>
          <Text>C</Text>
          <Text>D</Text>
        </box>
      </Modal>,
      { height: 16, width: 40 },
    )

    const frame = ui.captureCharFrame()

    expect(frame).toContain("A")
    expect(frame).toContain("B")
    expect(frame).toContain("C")
    expect(frame).toContain("D")
    expect(frame).toContain("Save")
    expect(frame.split("\n").find((line) => line.includes("Save"))?.indexOf("Save")).toBe(26)
  })

  test("centers the modal body within a three-cell screen inset", async () => {
    const ui = await render(
      <Modal height={6} width={20}>
        <Text>Body</Text>
      </Modal>,
      { height: 20, width: 40 },
    )

    const bodyLine = ui.captureCharFrame().split("\n").findIndex((line) => line.includes("Body"))

    expect(bodyLine).toBe(8)
  })

  test("renders single-escape chrome by default when given a title and close handler", async () => {
    const ui = await render(
      <Modal height={6} onClose={() => undefined} title="Settings" width={24}>
        <Text>Body</Text>
      </Modal>,
      { height: 20, width: 40 },
    )

    const frame = ui.captureCharFrame()

    expect(frame).toContain("Settings")
    expect(frame).toContain("esc")
    expect(frame).not.toContain("esc esc")
    expect(frame).toContain("Body")
    expect(frame.split("\n").findIndex((line) => line.includes("Settings"))).toBe(8)
  })

  test("renders double-escape chrome for focus-navigable modals", async () => {
    const ui = await render(
      <Modal focusNavigable height={6} onClose={() => undefined} title="Settings" width={24}>
        <Text>Body</Text>
      </Modal>,
      { height: 20, width: 40 },
    )

    const frame = ui.captureCharFrame()

    expect(frame).toContain("Settings")
    expect(frame).toContain("esc esc")
    expect(frame).toContain("Body")
  })
})
