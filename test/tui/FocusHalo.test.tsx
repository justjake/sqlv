import type { CapturedFrame, CapturedLine } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import { FocusChrome } from "../../src/tui/focus"
import { Focusable } from "../../src/tui/focus/Focusable"
import { useFocusTree } from "../../src/tui/focus/context"
import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

function FocusHaloHarness() {
  const tree = useFocusTree()

  useEffect(() => {
    queueMicrotask(() => {
      tree.focusPath(["root", "left"])
    })
  }, [tree])

  return (
    <box flexDirection="column" height="100%" position="relative" width="100%">
      <Focusable focusableId="root" flexDirection="row">
        <Focusable focusable focusableId="left" paddingLeft={1} paddingRight={1} width={8}>
          <text>LEFT</text>
        </Focusable>
        <box width={4} />
        <Focusable focusable focusableId="right" paddingLeft={1} paddingRight={1} width={8}>
          <text>RIGHT</text>
        </Focusable>
      </Focusable>
      <FocusChrome />
    </box>
  )
}

describe("FocusHalo", () => {
  test("renders the shared halo from the root overlay and moves it between highlight targets", async () => {
    const ui = await render(<FocusHaloHarness />, { height: 6, width: 40 })

    await settleDeferredRender(ui)
    expect(backgroundRegions(findHaloLine(ui.captureSpans()))).toHaveLength(0)

    await dispatchInput(ui, () => ui.mockInput.pressEscape())
    await settleDeferredRender(ui, 140)

    const leftRegion = backgroundRegions(findHaloLine(ui.captureSpans())).at(-1)
    expect(leftRegion).toBeDefined()
    expect(leftRegion?.width).toBeGreaterThan("LEFT".length)

    await dispatchInput(ui, () => ui.mockInput.pressArrow("right"))
    await settleDeferredRender(ui, 140)
    await settleDeferredRender(ui)

    const rightRegion = backgroundRegions(findHaloLine(ui.captureSpans())).at(-1)
    expect(rightRegion).toBeDefined()
    expect(rightRegion?.start).toBeGreaterThan((leftRegion?.start ?? 0) + (leftRegion?.width ?? 0))
  })
})

function backgroundRegions(line: CapturedLine) {
  const regions: Array<{ start: number; width: number }> = []
  let start: number | undefined
  let end = 0
  let offset = 0

  for (const span of line.spans) {
    const nextOffset = offset + span.width
    if (span.bg.a > 0) {
      start ??= offset
      end = nextOffset
    } else if (start !== undefined) {
      regions.push({ start, width: end - start })
      start = undefined
      end = 0
    }
    offset = nextOffset
  }

  if (start !== undefined) {
    regions.push({ start, width: end - start })
  }

  return regions
}

function findHaloLine(frame: CapturedFrame) {
  const line = frame.lines.find((candidate) => {
    const text = candidate.spans.map((span) => span.text).join("")
    return text.includes("LEFT") && text.includes("RIGHT")
  })

  if (!line) {
    throw new Error("Expected a line containing both focus halo targets")
  }

  return line
}
