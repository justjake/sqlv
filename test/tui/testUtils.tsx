import type { TestRendererOptions } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { afterEach } from "bun:test"

import { act, type ReactNode } from "react"

import { FocusProvider } from "../../src/apps/tui/focus/context"
import { KeybindProvider } from "../../src/apps/tui/ui/keybind/KeybindProvider"

export type RenderedUi = Awaited<ReturnType<typeof testRender>>

export function createTuiRenderHarness() {
  let rendered: RenderedUi | undefined

  afterEach(() => {
    rendered?.renderer.destroy()
    rendered = undefined
  })

  async function render(
    node: ReactNode,
    size: Pick<TestRendererOptions, "height" | "width"> & Partial<TestRendererOptions> = { height: 12, width: 60 },
  ) {
    rendered = await testRender(
      <FocusProvider>
        <KeybindProvider>{node}</KeybindProvider>
      </FocusProvider>,
      size,
    )
    await act(async () => {
      await rendered?.renderOnce()
    })
    return rendered
  }

  async function settleDeferredRender(ui: RenderedUi, delayMs = 0) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      await ui.renderOnce()
    })
  }

  async function dispatchInput(ui: RenderedUi, action: () => void | Promise<void>) {
    await act(async () => {
      await action()
      await new Promise((resolve) => setTimeout(resolve, 80))
      await ui.renderOnce()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await ui.renderOnce()
    })
  }

  return {
    dispatchInput,
    render,
    settleDeferredRender,
  }
}
