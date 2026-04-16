import { describe, expect, test } from "bun:test"

import { useEffect, useRef } from "react"

import { ConfirmModal } from "./ConfirmModal"
import { ModalPresenterProvider, usePresentModal } from "./presentModal"
import { Text } from "./Text"

import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

describe("presentModal", () => {
  test("presents a modal from a component and props and resolves its result", async () => {
    const results: boolean[] = []

    function Harness() {
      const presentModal = usePresentModal()
      const openedRef = useRef(false)

      useEffect(() => {
        if (openedRef.current) {
          return
        }
        openedRef.current = true

        void presentModal(ConfirmModal, {
          children: "Delete this connection?",
          default: "no",
          no: "Cancel",
          yes: "Delete",
        }).then((result) => {
          results.push(result)
        })
      }, [presentModal])

      return <Text>Host</Text>
    }

    const ui = await render(
      <ModalPresenterProvider>
        <Harness />
      </ModalPresenterProvider>,
      { height: 14, kittyKeyboard: true, width: 50 },
    )

    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("Delete this connection?")
    expect(ui.captureCharFrame()).toContain("Cancel")
    expect(ui.captureCharFrame()).toContain("Delete")

    await dispatchInput(ui, () => ui.mockInput.pressKey("c"))

    expect(results).toEqual([false])
    expect(ui.captureCharFrame()).toContain("Host")
    expect(ui.captureCharFrame()).not.toContain("Delete this connection?")
  })
})
