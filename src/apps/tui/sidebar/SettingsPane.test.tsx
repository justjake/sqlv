import { describe, expect, test } from "bun:test"

import { act } from "react"

import { App } from "../index"
import { SqlVisorProvider } from "../useSqlVisor"
import { createEngineStub, createQueryState } from "../../../testSupport"
import { createTuiRenderHarness } from "../testUtils"

const { render, settleDeferredRender } = createTuiRenderHarness()

describe("Sidebar settings", () => {
  test("opens from the global ctrl+, shortcut and updates app preferences", async () => {
    const stub = createEngineStub({
      connections: createQueryState({
        data: [],
        dataUpdateCount: 1,
        status: "success",
      }),
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 18, width: 80 },
    )

    expect(ui.captureCharFrame()).not.toContain("Icon style")

    await act(async () => {
      ui.mockInput.pressKey(",", { ctrl: true })
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("Settings")
    expect(ui.captureCharFrame()).toContain("esc")
    expect(ui.captureCharFrame()).not.toContain("esc esc")
    expect(ui.captureCharFrame()).toContain("Appearance")
    expect(ui.captureCharFrame()).toContain("Icon style")
    expect(ui.captureCharFrame()).toContain("◉ NerdFont")
    expect(ui.captureCharFrame()).toContain("○ Unicode")
    expect(ui.captureCharFrame()).toContain("Folder open")
    expect(ui.captureCharFrame()).toContain("Database")

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(stub.calls.updateAppState).toEqual([
      {
        fallback: { iconStyle: "nerdfont" },
        id: "preferences",
        patch: { iconStyle: "unicode" },
      },
    ])
    expect(ui.captureCharFrame()).toContain("◉ Unicode")
  })

  test("closes on a single escape in the shared non-focus-navigable modal", async () => {
    const stub = createEngineStub({
      connections: createQueryState({
        data: [],
        dataUpdateCount: 1,
        status: "success",
      }),
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 18, width: 80 },
    )

    await act(async () => {
      ui.mockInput.pressKey(",", { ctrl: true })
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("Settings")

    await act(async () => {
      ui.mockInput.pressEscape()
      await Bun.sleep(30)
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).not.toContain("Appearance")
    expect(ui.captureCharFrame()).not.toContain("Icon style")
  })
})
