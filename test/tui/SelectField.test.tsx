import { describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { SelectField } from "../../src/apps/tui/form/SelectField"
import { Text } from "../../src/apps/tui/ui/Text"
import { createTuiRenderHarness } from "./testUtils"

const { render, settleDeferredRender } = createTuiRenderHarness()

describe("SelectField", () => {
  test("fills the full select row background and cycles options from the keyboard", async () => {
    function Harness() {
      const [value, setValue] = useState<"aes128gcm" | "aes256gcm">("aes128gcm")

      return (
        <SelectField
          autoFocus
          focusableId="cipher"
          hint="← ⟶ cycle"
          label="Cipher"
          onChange={setValue}
          options={[
            { label: "AES-128-GCM", value: "aes128gcm" },
            { label: "AES-256-GCM", value: "aes256gcm" },
          ]}
          value={value}
        />
      )
    }

    const ui = await render(<Harness />, { height: 6, width: 40 })

    const selectLine = ui.captureSpans().lines.find((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .includes("AES-128-GCM"),
    )
    const backgroundWidth =
      selectLine?.spans.filter((span) => span.bg.a > 0).reduce((width, span) => width + span.width, 0) ?? 0

    expect(backgroundWidth).toBeGreaterThan("AES-128-GCM".length)

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("AES-256-GCM")
    expect(ui.captureCharFrame()).toContain("← ⟶ cycle")
  })

  test("does not cycle while disabled", async () => {
    function Harness() {
      const [value, setValue] = useState<"aes128gcm" | "aes256gcm">("aes128gcm")

      return (
        <SelectField
          autoFocus
          disabled
          focusableId="cipher"
          hint="← ⟶ cycle"
          label="Cipher"
          onChange={setValue}
          options={[
            { label: "AES-128-GCM", value: "aes128gcm" },
            { label: "AES-256-GCM", value: "aes256gcm" },
          ]}
          value={value}
        />
      )
    }

    const ui = await render(<Harness />, { height: 6, width: 40 })

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("AES-128-GCM")
    expect(ui.captureCharFrame()).not.toContain("AES-256-GCM")
    expect(ui.captureCharFrame()).not.toContain("← ⟶ cycle")
  })

  test("renders a rich selected option label", async () => {
    const ui = await render(
      <SelectField
        autoFocus
        focusableId="icon-style"
        label="Icon style"
        onChange={() => undefined}
        options={[
          {
            label: (
              <box flexDirection="column">
                <Text>NerdFont</Text>
                <Text>Folder</Text>
              </box>
            ),
            value: "nerdfont",
          },
        ]}
        value="nerdfont"
      />,
      { height: 8, width: 40 },
    )

    const frame = ui.captureCharFrame()

    expect(frame).toContain("NerdFont")
    expect(frame).toContain("Folder")
  })
})
