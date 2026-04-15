import { testRender } from "@opentui/react/test-utils"
import { afterEach } from "bun:test"
import { act, type ReactNode } from "react"
import { FocusProvider } from "../../src/tui/focus"
import { KeybindProvider } from "../../src/tui/ui/keybind"

export type RenderedUi = Awaited<ReturnType<typeof testRender>>

export function createTuiRenderHarness() {
  let rendered: RenderedUi | undefined

  afterEach(() => {
    rendered?.renderer.destroy()
    rendered = undefined
  })

  async function render(node: ReactNode, size = { height: 12, width: 60 }) {
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

  function focusedPathLine(ui: RenderedUi): string {
    return ui.captureCharFrame().split("\n")[0] ?? ""
  }

  return {
    dispatchInput,
    focusedPathLine,
    render,
    settleDeferredRender,
  }
}
