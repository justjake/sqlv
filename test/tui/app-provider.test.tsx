import { testRender } from "@opentui/react/test-utils"
import { afterEach, describe, expect, test } from "bun:test"
import { act, useEffect, type ReactNode } from "react"
import { FocusProvider, focusPathSignature, useFocusNavigationState, useFocusTree } from "../../src/tui/focus"
import { App, QUERY_INSPECTOR_FOCUS_ID, RECENT_QUERY_AREA_ID, RECENT_QUERY_FOCUS_ID, recentQueryFocusId } from "../../src/tui/index"
import { onEnterNode, Sidebar } from "../../src/tui/sidebar/Sidebar"
import { KeybindProvider } from "../../src/tui/ui/keybind"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "../../src/tui/useSqlVisor"
import { createEngineStub, createQueryState, makeConnection, makeQueryExecution } from "../support"

let rendered: Awaited<ReturnType<typeof testRender>> | undefined
let focusedPath: string | undefined

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
  focusedPath = undefined
})

function FocusController(props: { path: readonly string[] }) {
  const tree = useFocusTree()

  useEffect(() => {
    queueMicrotask(() => {
      queueMicrotask(() => {
        tree.focusPath(props.path)
      })
    })
  }, [props.path, tree])

  return null
}

function FocusProbe() {
  const state = useFocusNavigationState()
  focusedPath = focusPathSignature(state.focusedPath)
  return null
}

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

  test("renders fetching state and restores a filtered history query into the editor and inspector", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const failedEntry = makeQueryExecution({
      connectionId: connection.id,
      error: "query failed",
      id: "history-1",
      sql: "select 1",
    })
    const restorableEntry = makeQueryExecution({
      connectionId: connection.id,
      id: "history-2",
      rows: [{ total: 99 }],
      sql: "select 99 as total from audit_log",
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

    let stub!: ReturnType<typeof createEngineStub>
    stub = createEngineStub(
      {
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
        history: [restorableEntry, failedEntry],
        queryEditor: {
          text: "select 1",
        },
        selectedConnectionId: connection.id,
      },
      {
        restoreQueryExecution(entryId) {
          const entry = [restorableEntry, failedEntry].find((candidate) => candidate.id === entryId)
          if (!entry) {
            return
          }

          stub.setState({
            detailView:
              entry.status === "success"
                ? {
                    kind: "rows",
                    rows: entry.rows,
                    title: `Results (${entry.rows.length})`,
                  }
                : {
                    kind: "error",
                    message: entry.error ?? "query failed",
                    title: "Query Error",
                  },
            queryEditor: {
              text: entry.sql.source,
            },
            selectedConnectionId: entry.connectionId,
          })
        },
      },
    )
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
    expect(ui.captureCharFrame()).toContain("Query Finder")

    await act(async () => {
      ui.mockInput.pressKey("a")
      ui.mockInput.pressKey("u")
      ui.mockInput.pressKey("d")
      ui.mockInput.pressKey("i")
      ui.mockInput.pressKey("t")
      await ui.renderOnce()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      await ui.renderOnce()
    })
    expect(ui.captureCharFrame()).toContain("audit_log")

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      await ui.renderOnce()
    })

    expect(stub.calls.restoreQueryExecution).toEqual([restorableEntry.id])
    expect(ui.captureCharFrame()).toContain("select 99 as total from audit_log")
    expect(ui.captureCharFrame()).toContain("Results (1)")
    expect(ui.captureCharFrame()).toContain("99")
  })

  test("shows recent queries, caps finished rows at two, and moves focus to the inspector on enter", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const oldestFinished = makeQueryExecution({
      connectionId: connection.id,
      id: "history-1",
      rows: [{ id: 1 }],
      sql: "select 1",
    })
    const failedFinished = makeQueryExecution({
      connectionId: connection.id,
      error: "query failed",
      id: "history-2",
      sql: "select 2",
    })
    const newestFinished = makeQueryExecution({
      connectionId: connection.id,
      id: "history-3",
      rows: [{ id: 3 }],
      sql: "select 3",
    })
    const activeQueryId = "query-4"
    const stub = createEngineStub(
      {
        connections: createQueryState({
          data: [connection],
          dataUpdateCount: 1,
          status: "success",
        }),
        history: [newestFinished, failedFinished, oldestFinished],
        activeQueries: [
          {
            queryId: activeQueryId,
            text: "select 4",
            connectionId: connection.id,
            startedAt: Date.now(),
          },
        ],
        selectedConnectionId: connection.id,
      },
      {
        getQueryState(query) {
          if (query.queryId === activeQueryId) {
            return createQueryState({
              fetchStatus: "fetching",
              status: "pending",
            })
          }
          return createQueryState({
            data:
              query.queryId === newestFinished.id
                ? newestFinished
                : query.queryId === failedFinished.id
                  ? failedFinished
                  : oldestFinished,
            dataUpdateCount: 1,
            status: query.queryId === failedFinished.id ? "error" : "success",
          })
        },
      },
    )

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
        <FocusController
          path={[RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(activeQueryId)]}
        />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 24, width: 100 },
    )

    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("Recent Queries")
    expect(ui.captureCharFrame()).toContain("select 4")
    expect(ui.captureCharFrame()).toContain("select 3")
    expect(ui.captureCharFrame()).toContain("select 2")
    expect(ui.captureCharFrame()).not.toContain("select 1")
    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(activeQueryId)]),
    )

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(newestFinished.id)]),
    )

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(failedFinished.id)]),
    )

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature([QUERY_INSPECTOR_FOCUS_ID]))
    expect(ui.captureCharFrame()).toContain("Inspector")
    expect(ui.captureCharFrame()).toContain("query failed")
    expect(ui.captureCharFrame()).toContain("select 2")
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
