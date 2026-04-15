import { testRender } from "@opentui/react/test-utils"
import { afterEach, describe, expect, test } from "bun:test"
import { act, useEffect, type ReactNode } from "react"
import type { FocusTree } from "../../src/lib/focus"
import {
  RESULTS_TABLE_FOCUS_ID,
  RESULTS_TABLE_GRID_AREA_ID,
  resultsTableCellFocusId,
  resultsTableRowFocusId,
} from "../../src/tui/dataview/ResultsTable"
import { FocusProvider, focusPathSignature, useFocusNavigationState, useFocusTree } from "../../src/tui/focus"
import { App, RECENT_QUERY_AREA_ID, RECENT_QUERY_FOCUS_ID, recentQueryFocusId } from "../../src/tui/index"
import { ADD_CONNECTION_AREA_ID } from "../../src/tui/connection/AddConnectionPane"
import { onOpenNode, onSelectNode, Sidebar } from "../../src/tui/sidebar/Sidebar"
import { KeybindProvider } from "../../src/tui/ui/keybind"
import { Text } from "../../src/tui/ui/Text"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "../../src/tui/useSqlVisor"
import { createEngineStub, createQueryState, makeConnection, makeQueryExecution, makeSavedQuery } from "../support"

let rendered: Awaited<ReturnType<typeof testRender>> | undefined
let focusedPath = ""
let highlightedPath = ""
let focusNavigationActive = false
let focusTree: FocusTree | undefined

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
  highlightedPath = ""
  focusNavigationActive = false
  focusTree = undefined
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
  highlightedPath = focusPathSignature(state.highlightedPath) ?? ""
  focusNavigationActive = state.active
  return null
}

function FocusTreeProbe() {
  focusTree = useFocusTree()
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

  test("keeps loaded connection branches expanded when another connection is selected", async () => {
    const first = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-first",
      name: "Bun Memory",
      protocol: "bunsqlite",
    })
    const second = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-second",
      name: "Second Memory",
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [first, second],
        dataUpdateCount: 1,
        status: "success",
      }),
      objectsByConnectionId: {
        [first.id]: createQueryState({
          data: [{ database: "main", name: "users", schema: undefined, type: "table" }],
          dataUpdateCount: 1,
          status: "success",
        }),
        [second.id]: createQueryState({
          data: [{ database: "main", name: "orders", schema: undefined, type: "table" }],
          dataUpdateCount: 1,
          status: "success",
        }),
      },
      selectedConnectionId: second.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    expect(ui.captureCharFrame()).toContain("table users")
    expect(ui.captureCharFrame()).toContain("table orders")
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

  test("renders fetching state and restores a filtered history query into the editor and detail view", async () => {
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

  test("shows recent queries, caps finished rows at two, and keeps focus on the list for non-interactive detail states", async () => {
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

    expect(focusedPath).toBe(
      focusPathSignature([RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(failedFinished.id)]) ?? "",
    )
    expect(frameAfterInspect).not.toContain("Inspector")
    expect(frameAfterInspect).toContain("Query failed")
    expect(frameAfterInspect).toContain("query failed")
    expect(frameAfterInspect).toContain("select 2")
  })

  test("moves focus into the results table when selecting a query with rows", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      name: "Mem",
      protocol: "bunsqlite",
    })
    const finishedQuery = makeQueryExecution({
      connectionId: connection.id,
      id: "history-1",
      rows: [{ id: 1 }],
      sql: "select 1;",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      history: [finishedQuery],
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
        <FocusController
          path={[RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, recentQueryFocusId(finishedQuery.id)]}
        />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 18, width: 60 },
    )

    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(
      focusPathSignature([RESULTS_TABLE_FOCUS_ID, RESULTS_TABLE_GRID_AREA_ID, resultsTableRowFocusId(0), resultsTableCellFocusId(0)]) ?? "",
    )
    expect(ui.captureCharFrame()).toContain("1")
  })

  test("does not duplicate selected row metadata in the detail pane", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      name: "Mem",
      protocol: "bunsqlite",
    })
    const finishedQuery = makeQueryExecution({
      connectionId: connection.id,
      id: "history-1",
      rows: [{ id: 1 }],
      sql: "select 1;",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      history: [finishedQuery],
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
      </SqlVisorProvider>,
      { height: 12, width: 80 },
    )

    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    const frame = ui.captureCharFrame()
    expect(frame).not.toContain("Succeeded")
    expect(frame.match(/0ms/g)?.length ?? 0).toBe(1)
    expect(frame).toContain("1 row")
    expect(frame).toContain("id")
    expect(frame).toContain("1")
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
    expect(ui.captureCharFrame()).toContain("esc esc")
    expect(ui.captureCharFrame()).toContain("Protocol")
    expect(ui.captureCharFrame()).toContain("Connection Name")
    expect(ui.captureCharFrame()).toContain("[bunsqlite]")
  })

  test("allows clearing a seeded default field value in the add-connection modal", async () => {
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

    await act(async () => {
      ui.mockInput.pressTab()
      await ui.renderOnce()
      await ui.renderOnce()
    })

    for (let index = 0; index < ":memory:".length; index += 1) {
      await act(async () => {
        ui.mockInput.pressBackspace()
        await ui.renderOnce()
        await ui.renderOnce()
      })
    }

    const clearedFrame = ui.captureCharFrame()
    expect(clearedFrame).not.toContain("Path :memory:")

    await act(async () => {
      await ui.mockInput.typeText("tmp.db")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("Path")
    expect(ui.captureCharFrame()).toContain("tmp.db")
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
        <FocusTreeProbe />
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

    expect(focusNavigationActive).toBe(true)
    expect(focusedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "name"]) ?? "")
    expect(highlightedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "name"]) ?? "")
    expect(ui.captureCharFrame()).toContain("Add Connection")
    expect(ui.captureCharFrame()).toContain("esc esc")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(highlightedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "path"]) ?? "")

    await act(async () => {
      ui.mockInput.pressEscape()
      await Bun.sleep(30)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).not.toContain("Add Connection")
  })

  test("keeps add-connection field keybinds working after activating a checkbox from focus navigation", async () => {
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
        <FocusTreeProbe />
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

    expect(highlightedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "name"]) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(highlightedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "readonly"]) ?? "")
    expect(focusTree).toBeDefined()

    await act(async () => {
      focusTree?.activateHighlightedFocusable()
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusTree?.getNavigationState().active).toBe(false)
    expect(focusNavigationActive).toBe(false)
    expect(focusedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "readonly"]) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature([ADD_CONNECTION_AREA_ID, "create"]) ?? "")
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
