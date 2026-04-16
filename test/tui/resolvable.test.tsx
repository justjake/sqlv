import { describe, expect, test } from "bun:test"

import type { ReactElement } from "react"

import { ConfirmModal } from "../../src/apps/tui/ui/ConfirmModal"
import { ResolvableProvider, useResolvable, type ResolvableResolver } from "../../src/apps/tui/ui/resolvable"
import { Text } from "../../src/apps/tui/ui/Text"

import { createTuiRenderHarness } from "./testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

describe("useResolvable", () => {
  test("returns a no-op resolver outside a provider and preserves branded values", async () => {
    let resolver: ResolvableResolver<boolean> | undefined

    function Harness() {
      resolver = useResolvable<boolean>()
      return resolver(<Text>Body</Text>)
    }

    const ui = await render(<Harness />)
    const element = (<Text>After</Text>) as unknown as ReactElement
    const resolvable = resolver!

    expect(ui.captureCharFrame()).toContain("Body")
    expect(resolver).toBeDefined()
    expect(resolver?.resolve).toBeUndefined()
    expect(resolver?.resolveAs(true)).toBeUndefined()
    expect(resolver?.reject).toBeUndefined()
    expect(resolver?.rejectAs(new Error("boom"))).toBeUndefined()
    expect(resolvable(element)).toBe(element)
  })

  test("provides resolve and reject callbacks through the resolvable provider", async () => {
    const calls: string[] = []
    let resolver: ResolvableResolver<number> | undefined

    function Harness() {
      resolver = useResolvable<number>()
      return <Text>Body</Text>
    }

    await render(
      <ResolvableProvider<number>
        reject={(error) => calls.push(`reject:${error.message}`)}
        resolve={(value) => calls.push(`resolve:${value}`)}
      >
        <Harness />
      </ResolvableProvider>,
    )

    resolver?.resolve?.(1)
    resolver?.resolveAs(2)?.()
    resolver?.reject?.(new Error("boom"))
    resolver?.rejectAs(new Error("pow"))?.()

    expect(calls).toEqual(["resolve:1", "resolve:2", "reject:boom", "reject:pow"])
  })

  test("lets ConfirmModal resolve boolean results from context without explicit handlers", async () => {
    const values: boolean[] = []
    const ui = await render(
      <ResolvableProvider<boolean> resolve={(value) => values.push(value)}>
        <ConfirmModal default="yes">Body</ConfirmModal>
      </ResolvableProvider>,
      { height: 12, kittyKeyboard: true, width: 50 },
    )

    await settleDeferredRender(ui)

    await dispatchInput(ui, () => ui.mockInput.pressKey("n"))
    await dispatchInput(ui, () => ui.mockInput.pressEnter({ super: true }))

    expect(values).toEqual([false, true])
  })
})
