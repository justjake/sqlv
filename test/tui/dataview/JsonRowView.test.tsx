import { describe, expect, test } from "bun:test"

import { JsonRowView } from "../../../src/apps/tui/dataview/JsonRowView"
import { createTuiRenderHarness } from "../testUtils"

const { render } = createTuiRenderHarness()

describe("JsonRowView", () => {
  test("renders JSON rows", async () => {
    const ui = await render(<JsonRowView rows={[{ id: 1, name: "Ada" }]} />)

    expect(ui.captureCharFrame()).toContain('"id": 1')
    expect(ui.captureCharFrame()).toContain('"name": "Ada"')
  })
})
