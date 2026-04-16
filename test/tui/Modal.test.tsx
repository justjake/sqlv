import { describe, expect, test } from "bun:test"

import { Modal } from "../../src/apps/tui/ui/Modal"
import { Text } from "../../src/apps/tui/ui/Text"

import { createTuiRenderHarness } from "./testUtils"

const { render } = createTuiRenderHarness()

function findLineIndex(lines: string[], text: string) {
  return lines.findIndex((line) => line.includes(text))
}

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

    const lines = ui.captureCharFrame().split("\n")
    const bodyLineIndexes = ["A", "B", "C", "D"].map((label) => findLineIndex(lines, label))
    const dLineIndex = findLineIndex(lines, "D")
    const saveLineIndex = findLineIndex(lines, "Save")
    const saveLine = lines[saveLineIndex]

    expect(bodyLineIndexes).toEqual([
      bodyLineIndexes[0]!,
      bodyLineIndexes[0]! + 1,
      bodyLineIndexes[0]! + 2,
      bodyLineIndexes[0]! + 3,
    ])
    expect(saveLineIndex).toBe(dLineIndex)
    expect(saveLine).toContain("D")
    expect(saveLine?.indexOf("Save")).toBeGreaterThan(saveLine?.indexOf("D") ?? -1)
  })

  test("centers the modal body within a three-cell screen inset", async () => {
    const ui = await render(
      <Modal height={6} width={20}>
        <Text>Body</Text>
      </Modal>,
      { height: 20, width: 40 },
    )

    const lines = ui.captureCharFrame().split("\n")
    const bodyLineIndex = findLineIndex(lines, "Body")
    const centeredRow = Math.floor(lines.length / 2)

    expect(bodyLineIndex).toBeGreaterThanOrEqual(3)
    expect(bodyLineIndex).toBeLessThan(lines.length - 3)
    expect(Math.abs(bodyLineIndex - centeredRow)).toBeLessThanOrEqual(3)
  })

  test("renders single-escape chrome by default when given a title and close handler", async () => {
    const ui = await render(
      <Modal height={6} onClose={() => undefined} title="Settings" width={24}>
        <Text>Body</Text>
      </Modal>,
      { height: 20, width: 40 },
    )

    const frame = ui.captureCharFrame()
    const lines = frame.split("\n")

    expect(frame).toContain("Settings")
    expect(frame).toContain("esc")
    expect(frame).not.toContain("esc esc")
    expect(frame).toContain("Body")
    expect(findLineIndex(lines, "Settings")).toBeLessThan(findLineIndex(lines, "Body"))
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
