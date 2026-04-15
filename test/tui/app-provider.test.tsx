import { testRender } from "@opentui/react/test-utils"
import { afterEach, describe, expect, test } from "bun:test"
import { act, useEffect, type ReactNode } from "react"
import { FocusProvider, focusPathSignature, useFocusNavigationState, useFocusTree } from "../../src/tui/focus"
import { App, QUERY_INSPECTOR_FOCUS_ID, RECENT_QUERY_AREA_ID, RECENT_QUERY_FOCUS_ID, recentQueryFocusId } from "../../src/tui/index"
import { ADD_CONNECTION_AREA_ID } from "../../src/tui/connection/AddConnectionPane"
import { onOpenNode, onSelectNode, Sidebar } from "../../src/tui/sidebar/Sidebar"
import { KeybindProvider } from "../../src/tui/ui/keybind"
import { Text } from "../../src/tui/ui/Text"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "../../src/tui/useSqlVisor"
import { createEngineStub, createQueryState, makeConnection, makeQueryExecution, makeSavedQuery } from "../support"

let rendered: Awaited<ReturnType<typeof testRender>> | undefined
let focusedPath = ""

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
  focusedPath = ""
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
  focusedPath = focusPathSignature(state.focusedPath) ?? ""
  return null
}

describe("SqlVisor provider and app", () => {
  test("requires a SqlVisor provider", async () => {
    function NeedsProvider() {
      useSqlVisor()
      return <Text>missing</Text>
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
      return <Text>{engine === stub.engine ? `selected:${state.selectedConnectionId}` : "wrong-engine"}</Text>
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

    onOpenNode(stub.engine, {
      connectionId: connection.id,
      key: connection.id,
      kind: "connection",
      name: connection.name,
    })

    onSelectNode(stub.engine, {
      connectionId: connection.id,
      key: `${connection.id}.table.0`,
      kind: "table",
      name: "table users",
    })

    expect(stub.calls.selectConnection).toEqual([connection.id, connection.id])
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

    expect(ui.captureCharFrame()).toContain("Ada")
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
    expect(ui.captureCharFrame()).toContain("Query running")
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
        history: [failedEntry, restorableEntry],
        editor: {
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
            editor: {
              ...stub.getState().editor,
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

    expect(ui.captureCharFrame()).toContain("Query failed")
    expect(ui.captureCharFrame()).toContain("query failed")

    await act(async () => {
      ui.mockInput.pressKey("r", { ctrl: true })
      await ui.renderOnce()
    })
    expect(ui.captureCharFrame()).toContain("Filter")

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
    expect(ui.captureCharFrame()).toContain("99")
  })

  test("returns focus to the editor when query history closes with escape", async () => {
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
      editor: {
        cursorOffset: "select ".length,
        text: "select ",
      },
      history: [
        makeQueryExecution({
          connectionId: connection.id,
          id: "history-1",
          sql: "select * from users",
        }),
      ],
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    await act(async () => {
      ui.mockInput.pressKey("r", { ctrl: true })
      await ui.renderOnce()
    })
    expect(ui.captureCharFrame()).toContain("Filter")

    await act(async () => {
      ui.mockInput.pressEscape()
      await Bun.sleep(30)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).not.toContain("Filter")

    await act(async () => {
      ui.mockInput.pressKey("x")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(stub.getState().editor.text).toBe("select x")
  })

  test("restores saved queries from ctrl-r and clears the detail pane when no execution exists", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const newestEntry = makeQueryExecution({
      connectionId: connection.id,
      id: "history-newest",
      rows: [{ value: 1 }],
      sql: "select 1",
    })
    const newerEntry = makeQueryExecution({
      connectionId: connection.id,
      id: "history-newer",
      rows: [{ value: 2 }],
      sql: "select 2",
    })
    const savedExecution = makeQueryExecution({
      connectionId: connection.id,
      id: "history-saved",
      rows: [{ total: 404 }],
      savedQueryId: "saved-audit",
      sql: "select 404 as forced_saved_result_marker",
    })
    const savedAudit = makeSavedQuery({
      id: "saved-audit",
      name: "Audit Dashboard",
      protocol: "bunsqlite",
      text: "select 404 as forced_saved_result_marker",
    })
    const savedNoRun = makeSavedQuery({
      id: "saved-empty",
      name: "Pending Jobs",
      protocol: "bunsqlite",
      text: "select * from pending_jobs",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      history: [newestEntry, newerEntry, savedExecution],
      savedQueries: [savedAudit, savedNoRun],
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 22, width: 100 },
    )

    await act(async () => {
      ui.mockInput.pressKey("r", { ctrl: true })
      await ui.renderOnce()
    })
    await act(async () => {
      ui.mockInput.pressArrow("down")
      ui.mockInput.pressArrow("down")
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      await ui.renderOnce()
    })

    expect(stub.calls.restoreSavedQuery).toEqual(["saved-audit"])
    expect(ui.captureCharFrame()).toContain("select 404 as forced_saved_result_marker")
    expect(ui.captureCharFrame()).toContain("404")

    await act(async () => {
      ui.mockInput.pressKey("r", { ctrl: true })
      await ui.renderOnce()
    })
    await act(async () => {
      ui.mockInput.pressArrow("down")
      ui.mockInput.pressArrow("down")
      ui.mockInput.pressArrow("down")
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      await ui.renderOnce()
    })

    expect(stub.calls.restoreSavedQuery).toEqual(["saved-audit", "saved-empty"])
    expect(ui.captureCharFrame()).toContain("select * from pending_jobs")
    expect(ui.captureCharFrame()).toContain("No query run selected")
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
    const systemFinished = makeQueryExecution({
      connectionId: connection.id,
      id: "history-system",
      initiator: "system",
      sql: "pragma table_info(posts)",
    })
    const activeQueryId = "query-4"
    const stub = createEngineStub(
      {
        connections: createQueryState({
          data: [connection],
          dataUpdateCount: 1,
          status: "success",
        }),
        history: [systemFinished, newestFinished, failedFinished, oldestFinished],
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

    expect(ui.captureCharFrame()).not.toContain("Recent Queries")
    expect(ui.captureCharFrame()).toContain("select 4")
    expect(ui.captureCharFrame()).toContain("select 3")
    expect(ui.captureCharFrame()).toContain("select 2")
    expect(ui.captureCharFrame()).not.toContain("select 1")
    expect(ui.captureCharFrame()).not.toContain("pragma table_info(posts)")
    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(activeQueryId)]) ?? "",
    )

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(newestFinished.id)]) ?? "",
    )

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(failedFinished.id)]) ?? "",
    )
    expect(ui.captureCharFrame()).toContain("Query running")

    let frameAfterInspect = ""
    await act(async () => {
      ui.mockInput.pressEnter()
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await ui.renderOnce()
        frameAfterInspect = ui.captureCharFrame()
        if (frameAfterInspect.includes("query failed")) {
          break
        }
        await Bun.sleep(0)
      }
    })

    expect(focusedPath).toBe(focusPathSignature([QUERY_INSPECTOR_FOCUS_ID]) ?? "")
    expect(frameAfterInspect).not.toContain("Inspector")
    expect(frameAfterInspect).toContain("Query failed")
    expect(frameAfterInspect).toContain("query failed")
    expect(frameAfterInspect).toContain("select 2")
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
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 24, width: 100 },
    )

    await act(async () => {
      ui.mockInput.pressKey("n", { ctrl: true })
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressEscape()
      await Bun.sleep(30)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID]) ?? "")
    expect(ui.captureCharFrame()).toContain("Add Connection")

    await act(async () => {
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
      editor: {
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
    expect(stub.getState().editor.text).toBe("abc")
  })
})
