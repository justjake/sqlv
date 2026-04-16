import { RGBA, TextAttributes, type CapturedFrame, type CapturedLine } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import { FocusChrome, Focusable, useFocusTree } from "../../src/tui/focus"
import { labelizeShortcutInput } from "../../src/tui/ui/keybind"
import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

function FocusNavigationHintHarness() {
  const tree = useFocusTree()

  useEffect(() => {
    queueMicrotask(() => {
      tree.focusPath(["target"])
    })
  }, [tree])

  return (
    <box height="100%" position="relative" width="100%">
      <Focusable bottom={1} focusable focusableId="target" height={3} left={0} position="absolute" width="100%">
        <text>Target</text>
      </Focusable>
      <FocusChrome />
    </box>
  )
}

describe("FocusNavigationHint", () => {
  test("renders the redesigned focus nav hint with inset padding and styled labels", async () => {
    const ui = await render(<FocusNavigationHintHarness />, { height: 10, width: 100 })

    await settleDeferredRender(ui)
    await dispatchInput(ui, () => ui.mockInput.pressEscape())
    await settleDeferredRender(ui, 30)

    const frame = ui.captureSpans()
    const hintLine = findHintLine(frame)
    const hintText = hintLine.spans.map((span) => span.text).join("")
    const white = RGBA.fromHex("#ffffff")
    const gray = RGBA.fromHex("#a7a7a7")
    const focusShortcutLabel = labelizeShortcutInput({ or: ["return", "space"] })
    const hasBoldWhiteHeading = hintLine.spans.some(
      (span) => span.fg.equals(white) && ((span.attributes & TextAttributes.BOLD) === TextAttributes.BOLD),
    )
    const hasHaloOutsideHint = hintLine.spans.some((span) => span.text.trim() === "" && span.bg.a > 0 && span.bg.a < 0.5)
    const hasOpaqueHeadingBackground = hintLine.spans.some((span) => span.text === "focus nav" && span.bg.a > 0.99)
    const grayFocusActions = hintLine.spans.filter((span) => span.text === "focus" && span.fg.equals(gray))
    const hasGrayMoveLabel = hintLine.spans.some((span) => span.text.includes("move") && span.fg.equals(gray))

    expect(hintText).toContain("focus nav")
    expect(hintText).toContain("↑↓←→/hjkl move")
    expect(hintText).toContain(`${focusShortcutLabel} focus`)
    expect(hintText).toContain("⮐")
    expect(hintText).toContain("esc cancel")
    expect(hintText).not.toContain("┌")
    expect(hintText).not.toContain("│")
    expect(hasBoldWhiteHeading).toBe(true)
    expect(hasHaloOutsideHint).toBe(true)
    expect(hasOpaqueHeadingBackground).toBe(true)
    expect(hasGrayMoveLabel).toBe(true)
    expect(grayFocusActions).toHaveLength(1)
    expect(hasBackground(frame.lines.at(-1))).toBe(false)
  })
})

function findHintLine(frame: CapturedFrame): CapturedLine {
  const line = frame.lines.find((candidate) => candidate.spans.map((span) => span.text).join("").includes("focus nav"))

  if (!line) {
    throw new Error("Expected a line containing the focus navigation hint")
  }

  return line
}

function hasBackground(line: CapturedLine | undefined): boolean {
  return line?.spans.some((span) => span.bg.a > 0) ?? false
}
