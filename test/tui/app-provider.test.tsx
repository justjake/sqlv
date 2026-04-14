import { testRender } from "@opentui/react/test-utils"
import { afterEach, describe, expect, test } from "bun:test"
import { act, type ReactNode } from "react"
import { FocusProvider } from "../../src/tui/focus"
import { App } from "../../src/tui/index"
import { onEnterNode, Sidebar } from "../../src/tui/sidebar/Sidebar"
import { KeybindProvider } from "../../src/tui/ui/keybind"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "../../src/tui/useSqlVisor"
import { createEngineStub, createQueryState, makeConnection, makeQueryExecution } from "../support"

let rendered: Awaited<ReturnType<typeof testRender>> | undefined

async function render(node: ReactNode, size = { height: 18, width: 100 }) {
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

afterEach(() => {
  rendered?.renderer.destroy()
  rendered = undefined
})

describe("SqlVisor provider and app", () => {
  test("requires a SqlVisor provider", async () => {
    function NeedsProvider() {
      useSqlVisor()
      return <text>missing</text>
    }

    const ui = await render(<NeedsProvider />, { height: 5, width: 60 })
    expect(ui.captureCharFrame()).toContain("SqlVisorContext not provided")
  })

  test("reads engine state through the provider", async () => {
    const stub = createEngineStub({
      selectedConnectionId: "conn-1",
    })

    function Consumer() {
      const engine = useSqlVisor()
      const state = useSqlVisorState()
      return <text>{engine === stub.engine ? `selected:${state.selectedConnectionId}` : "wrong-engine"}</text>
    }

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Consumer />
      </SqlVisorProvider>,
      { height: 5, width: 40 },
    )

    expect(ui.captureCharFrame()).toContain("selected:conn-1")
  })

  test("renders sidebar loading, error, and empty states", async () => {
    const loading = createEngineStub({
      connections: createQueryState({
        fetchStatus: "fetching",
        status: "pending",
      }),
    })
    let ui = await render(
      <SqlVisorProvider engine={loading.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
    )
    expect(ui.captureCharFrame()).toContain("Loading connections...")
    ui.renderer.destroy()

    const failed = createEngineStub({
      connections: createQueryState({
        error: new Error("load failed"),
        errorUpdateCount: 1,
        errorUpdatedAt: 1,
        status: "error",
      }),
    })
    ui = await render(
      <SqlVisorProvider engine={failed.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
    )
    expect(ui.captureCharFrame()).toContain("load failed")
    ui.renderer.destroy()

    const empty = createEngineStub({
      connections: createQueryState({
        data: [],
        dataUpdateCount: 1,
        status: "success",
      }),
    })
    ui = await render(
      <SqlVisorProvider engine={empty.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
    )
    expect(ui.captureCharFrame()).toContain("No connections yet. Use the public API or add one next.")
  })

  test("renders sidebar object labels and handles keyboard actions", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      objectsByConnectionId: {
        [connection.id]: createQueryState({
          data: [
            { name: "main", type: "database" },
            { database: "main", name: "public", type: "schema" },
            { database: "main", name: "users", schema: undefined, type: "table" },
            { database: "main", name: "active_users", schema: undefined, type: "view" },
            { database: "main", name: "latest_users", schema: undefined, type: "matview" },
            {
              on: { database: "main", name: "users", schema: undefined, type: "table" },
              type: "index",
            },
            {
              on: { database: "main", name: "users", schema: undefined, type: "table" },
              type: "trigger",
            },
          ],
          dataUpdateCount: 1,
          status: "success",
        }),
      },
      selectedConnectionId: connection.id,
    })
    let addConnectionCount = 0
    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => (addConnectionCount += 1)} />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    expect(ui.captureCharFrame()).toContain("db main")
    expect(ui.captureCharFrame()).toContain("schema public")
    expect(ui.captureCharFrame()).toContain("table users")
    expect(ui.captureCharFrame()).toContain("view active_users")
    expect(ui.captureCharFrame()).toContain("matview latest_users")
    expect(ui.captureCharFrame()).toContain("index on users")
    expect(ui.captureCharFrame()).toContain("trigger on users")

    await act(async () => {
      ui.mockInput.pressKey("n", { ctrl: true })
      await ui.renderOnce()
    })

    onEnterNode(stub.engine, {
      connectionId: connection.id,
      key: connection.id,
      kind: "connection",
      name: connection.name,
    })

    expect(stub.calls.selectConnection).toEqual([connection.id])
    expect(addConnectionCount).toBe(1)
  })

  test("renders row detail views in the app", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      detailView: {
        kind: "rows",
        rows: [{ id: 1, name: "Ada" }],
        title: "Rows",
      },
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    expect(ui.captureCharFrame()).toContain("Rows")
  })

  test("renders fetching and error detail states and switches panes", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const historyEntry = makeQueryExecution({
      connectionId: connection.id,
      error: "query failed",
      id: "history-1",
      sql: "select 1",
    })
    const fetchingStub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      queryExecution: createQueryState({
        fetchStatus: "fetching",
        status: "pending",
      }),
      activeQueries: [{
        queryId: "query-1",
        text: "select 1",
        connectionId: connection.id,
        startedAt: Date.now(),
      }],
      selectedConnectionId: connection.id,
    })
    let ui = await render(
      <SqlVisorProvider engine={fetchingStub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    expect(ui.captureCharFrame()).toContain("select 1")
    expect(ui.captureCharFrame()).toContain("cancel")
    ui.renderer.destroy()

    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      detailView: {
        kind: "error",
        message: "query failed",
        title: "Query Error",
      },
      history: [historyEntry],
      queryEditor: {
        text: "select 1",
      },
      selectedConnectionId: connection.id,
    })
    ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    expect(ui.captureCharFrame()).toContain("Query Error")
    expect(ui.captureCharFrame()).toContain("query failed")

    await act(async () => {
      ui.mockInput.pressKey("r", { ctrl: true })
      await ui.renderOnce()
    })
    expect(ui.captureCharFrame()).toContain("select 1")
  })

  test("renders the connection form from adapter specs", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 24, width: 100 },
    )

    await act(async () => {
      ui.mockInput.pressKey("n", { ctrl: true })
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("Add Connection")
    expect(ui.captureCharFrame()).toContain("[bunsqlite]")
    expect(ui.captureCharFrame()).toContain(":memory:")
  })

  test("uses escape-driven focus navigation inside the add-connection modal", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 24, width: 100 },
    )

    await act(async () => {
      ui.mockInput.pressKey("n", { ctrl: true })
      await ui.renderOnce()
      await ui.renderOnce()
      ui.mockInput.pressEscape()
      await Bun.sleep(30)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("Esc Close")

    await act(async () => {
      ui.mockInput.pressEscape()
      await Bun.sleep(30)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).not.toContain("Add Connection")
  })

  test("keeps the query editor text stable across engine state updates", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      selectedConnectionId: connection.id,
      queryEditor: {
        text: "",
      },
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    await act(async () => {
      ui.mockInput.pressKey("a")
      await ui.renderOnce()
      ui.mockInput.pressKey("b")
      await ui.renderOnce()
      ui.mockInput.pressKey("c")
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("abc")
    expect(stub.getState().queryEditor.text).toBe("abc")
  })
})
