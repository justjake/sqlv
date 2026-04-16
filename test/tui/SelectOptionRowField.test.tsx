import { RGBA } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { SelectOptionRowField } from "../../src/tui/form/SelectOptionRowField"
import { Text } from "../../src/tui/ui/Text"
import { createTuiRenderHarness } from "./testUtils"

const { render, settleDeferredRender } = createTuiRenderHarness()

describe("SelectOptionRowField", () => {
  test("fills the full option row background and colors the selected radio dot", async () => {
    const ui = await render(
      <SelectOptionRowField
        autoFocus
        focusableId="protocol"
        hint="← ⟶ cycle"
        label="Protocol"
        onChange={() => undefined}
        options={[
          { key: "bunsqlite", label: "bunsqlite", value: "bunsqlite" },
          { key: "turso", label: "turso", value: "turso" },
        ]}
        value="bunsqlite"
      />,
      { height: 6, width: 50 },
    )

    const radioLine = ui.captureSpans().lines.find((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .includes("◉ bunsqlite"),
    )
    const backgroundWidth =
      radioLine?.spans.filter((span) => span.bg.a > 0).reduce((width, span) => width + span.width, 0) ?? 0
    const indicator = radioLine?.spans.find((span) => span.text === "◉")

    expect(backgroundWidth).toBeGreaterThan("◉ bunsqlite  ○ turso".length)
    expect(indicator?.fg.equals(RGBA.fromHex("#639ee4"))).toBe(true)
  })

  test("cycles options from the keyboard when the field input is focused", async () => {
    function Harness() {
      const [value, setValue] = useState<"bunsqlite" | "turso">("bunsqlite")

      return (
        <SelectOptionRowField
          autoFocus
          focusableId="protocol"
          label="Protocol"
          onChange={setValue}
          options={[
            { key: "bunsqlite", label: "bunsqlite", value: "bunsqlite" },
            { key: "turso", label: "turso", value: "turso" },
          ]}
          value={value}
        />
      )
    }

    const ui = await render(<Harness />, { height: 6, width: 50 })

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("◉ turso")
    expect(ui.captureCharFrame()).toContain("○ bunsqlite")

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("◉ bunsqlite")
    expect(ui.captureCharFrame()).toContain("○ turso")
  })

  test("does not cycle while disabled", async () => {
    function Harness() {
      const [value, setValue] = useState<"bunsqlite" | "turso">("bunsqlite")

      return (
        <SelectOptionRowField
          autoFocus
          disabled
          focusableId="protocol"
          hint="← ⟶ cycle"
          label="Protocol"
          onChange={setValue}
          options={[
            { key: "bunsqlite", label: "bunsqlite", value: "bunsqlite" },
            { key: "turso", label: "turso", value: "turso" },
          ]}
          value={value}
        />
      )
    }

    const ui = await render(<Harness />, { height: 6, width: 50 })

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("◉ bunsqlite")
    expect(ui.captureCharFrame()).toContain("○ turso")
    expect(ui.captureCharFrame()).not.toContain("← ⟶ cycle")
  })

  test("resets the prev next anchor to the first option when the remembered key is removed", async () => {
    let removeSelectedOption: (() => void) | undefined

    function Harness() {
      const [value, setValue] = useState<"bunsqlite" | "turso" | "libsql">("turso")
      const [options, setOptions] = useState([
        { key: "bunsqlite", label: "bunsqlite", value: "bunsqlite" as const },
        { key: "turso", label: "turso", value: "turso" as const },
        { key: "libsql", label: "libsql", value: "libsql" as const },
      ])

      removeSelectedOption = () => {
        setOptions([
          { key: "bunsqlite", label: "bunsqlite", value: "bunsqlite" as const },
          { key: "libsql", label: "libsql", value: "libsql" as const },
        ])
      }

      return (
        <SelectOptionRowField autoFocus focusableId="protocol" label="Protocol" onChange={setValue} options={options} value={value} />
      )
    }

    const ui = await render(<Harness />, { height: 6, width: 50 })

    await act(async () => {
      removeSelectedOption?.()
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
    })
    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("◉ libsql")
    expect(ui.captureCharFrame()).toContain("○ bunsqlite")
  })

  test("renders rich multi-line option labels", async () => {
    const ui = await render(
      <SelectOptionRowField
        autoFocus
        focusableId="icon-style"
        label="Icon style"
        onChange={() => undefined}
        options={[
          {
            key: "nerdfont",
            label: (
              <box flexDirection="column">
                <Text>NerdFont</Text>
                <Text>Folder</Text>
              </box>
            ),
            value: "nerdfont",
          },
          {
            key: "unicode",
            label: (
              <box flexDirection="column">
                <Text>Unicode</Text>
                <Text>Database</Text>
              </box>
            ),
            value: "unicode",
          },
        ]}
        value="nerdfont"
      />,
      { height: 8, width: 50 },
    )

    const frame = ui.captureCharFrame()

    expect(frame).toContain("NerdFont")
    expect(frame).toContain("Folder")
    expect(frame).toContain("Unicode")
    expect(frame).toContain("Database")
  })
})
