import { describe, expect, test } from "bun:test"

import { useState } from "react"

import { clampHistoryIndex, QueryHistory } from "./QueryHistory"
import { makeConnection, makeQueryExecution, makeSavedQuery } from "../../../testSupport"
import { createTuiRenderHarness } from "../testUtils"

const { dispatchInput, render, settleDeferredRender } = createTuiRenderHarness()

describe("QueryHistory", () => {
  test("filters query history and restores the selected entry", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const restored: string[] = []
    const ui = await render(
      <QueryHistory
        entries={[
          makeQueryExecution({
            connectionId: connection.id,
            id: "one",
            sql: "select * from users",
          }),
          makeQueryExecution({
            connectionId: connection.id,
            id: "two",
            sql: "select * from orders where status = 'open'",
          }),
          makeQueryExecution({
            connectionId: connection.id,
            id: "three",
            sql: "delete from users where id = 1",
            status: "cancelled",
          }),
        ]}
        connections={[connection]}
        savedQueries={[]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => undefined}
        onRestore={(entry) => restored.push(entry.kind === "history" ? entry.entry.id : entry.savedQuery.id)}
      />,
      { height: 14, width: 80 },
    )

    await settleDeferredRender(ui)

    expect(ui.captureCharFrame()).toContain("Filter")
    expect(clampHistoryIndex(3, 2)).toBe(1)
    expect(clampHistoryIndex(-1, 2)).toBe(0)

    await dispatchInput(ui, () => {
      ui.mockInput.pressKey("o")
      ui.mockInput.pressKey("r")
      ui.mockInput.pressKey("d")
    })
    await settleDeferredRender(ui, 120)

    const frame = ui.captureCharFrame()
    expect(frame).toContain("status = 'open'")
    expect(frame).not.toContain("delete from users")

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    expect(restored).toEqual(["two"])
  })

  test("finds saved queries by name before history text matches", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const restored: string[] = []
    const ui = await render(
      <QueryHistory
        entries={[
          makeQueryExecution({
            connectionId: connection.id,
            id: "history-orders",
            sql: "select * from orders",
          }),
        ]}
        connections={[connection]}
        savedQueries={[
          makeSavedQuery({
            id: "saved-orders",
            name: "OrdersBoard",
            protocol: "bunsqlite",
            text: "select count(*) from audit_log",
          }),
        ]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => undefined}
        onRestore={(entry) =>
          restored.push(entry.kind === "saved" ? `saved:${entry.savedQuery.id}` : `history:${entry.entry.id}`)
        }
      />,
      { height: 14, width: 80 },
    )

    await settleDeferredRender(ui)
    await dispatchInput(ui, () => {
      ui.mockInput.pressKey("o")
      ui.mockInput.pressKey("r")
      ui.mockInput.pressKey("d")
      ui.mockInput.pressKey("e")
      ui.mockInput.pressKey("r")
      ui.mockInput.pressKey("s")
    })
    await settleDeferredRender(ui, 120)

    expect(ui.captureCharFrame()).toContain("saved")

    await dispatchInput(ui, () => ui.mockInput.pressEnter())
    expect(restored).toEqual(["saved:saved-orders"])
  })

  test("toggles system queries in query history", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })

    function Harness() {
      const [showSystemQueries, setShowSystemQueries] = useState(false)

      return (
        <QueryHistory
          entries={[
            makeQueryExecution({
              connectionId: connection.id,
              id: "user-query",
              sql: "select * from users",
            }),
            makeQueryExecution({
              connectionId: connection.id,
              id: "system-query",
              initiator: "system",
              sql: "EXPLAIN select * from users",
            }),
          ]}
          connections={[connection]}
          savedQueries={[]}
          showSystemQueries={showSystemQueries}
          onToggleShowSystemQueries={() => setShowSystemQueries((current) => !current)}
          onBack={() => undefined}
          onRestore={() => undefined}
        />
      )
    }

    const ui = await render(<Harness />, { height: 14, width: 80 })

    expect(ui.captureCharFrame()).toContain("select * from users")
    expect(ui.captureCharFrame()).not.toContain("EXPLAIN select * from users")

    await dispatchInput(ui, () => ui.mockInput.pressKey("g", { ctrl: true }))

    expect(ui.captureCharFrame()).toContain("EXPLAIN select * from users")
    expect(ui.captureCharFrame()).toContain("[x] Show system queries")
  })

  test("shows the empty query history state", async () => {
    const ui = await render(
      <QueryHistory
        connections={[]}
        entries={[]}
        savedQueries={[]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => undefined}
        onRestore={() => undefined}
      />,
    )
    expect(ui.captureCharFrame()).toContain("No previous or saved queries yet.")
  })

  test("routes escape through the pane shortcut before focus navigation fallback", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    let backCount = 0
    const ui = await render(
      <QueryHistory
        connections={[connection]}
        entries={[
          makeQueryExecution({
            connectionId: connection.id,
            id: "history-1",
            sql: "select * from users",
          }),
        ]}
        savedQueries={[]}
        showSystemQueries={false}
        onToggleShowSystemQueries={() => undefined}
        onBack={() => {
          backCount += 1
        }}
        onRestore={() => undefined}
      />,
      { height: 14, width: 80 },
    )

    await settleDeferredRender(ui)
    await dispatchInput(ui, () => ui.mockInput.pressEscape())

    expect(backCount).toBe(1)
    expect(ui.captureCharFrame()).toContain("Filter")
  })
})
