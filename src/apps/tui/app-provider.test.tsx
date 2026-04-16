import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act, useEffect, type ReactNode } from "react"

import { AddConnectionPane, ADD_CONNECTION_AREA_ID } from "./connection/AddConnectionPane"
import { RESULTS_TABLE_FOCUS_ID, RESULTS_TABLE_GRID_AREA_ID } from "./dataview/ResultsTable"
import {
  FocusProvider,
  focusPathSignature,
  useFocusNavigationState,
  useFocusTree,
} from "./focus/context"
import { App, RECENT_QUERY_AREA_ID, RECENT_QUERY_FOCUS_ID } from "./index"
import { PostgresAdapter } from "../../adapters/postgres/PgAdapter"
import { onOpenNode, onSelectNode, SIDEBAR_AREA_ID, Sidebar } from "./sidebar/Sidebar"
import { SIDEBAR_TREE_AREA_ID } from "./sidebar/TreeView"
import { KeybindProvider } from "./ui/keybind/KeybindProvider"
import { Text } from "./ui/Text"
import { SqlVisorProvider, useSqlVisor, useSqlVisorState } from "./useSqlVisor"
import { createEngineStub, createQueryState, makeConnection, makeQueryExecution, makeSavedQuery } from "../../testSupport"

type RenderedUi = Awaited<ReturnType<typeof testRender>>

let rendered: RenderedUi | undefined
let focusedPath = ""
let highlightedPath = ""
let focusNavigationActive = false
const postgresConnectionSpec = new PostgresAdapter().getConnectionSpec()
const defaultPostgresURI =
  postgresConnectionSpec.toURI?.(
    postgresConnectionSpec.createConfig({
      database: "postgres",
      host: "localhost",
      port: "5432",
      ssl: false,
    }),
  ) ?? ""

const ADD_CONNECTION_FIELD_SLOT = {
  create: 4,
  host: 9,
  name: 1,
  path: 2,
  protocol: 0,
  readonly: 3,
  uri: 8,
} as const

function addConnectionInputPath(key: keyof typeof ADD_CONNECTION_FIELD_SLOT) {
  return [ADD_CONNECTION_AREA_ID, `field-${ADD_CONNECTION_FIELD_SLOT[key]}`, "input"] as const
}

function sidebarRowPath(slot: number) {
  return [SIDEBAR_AREA_ID, SIDEBAR_TREE_AREA_ID, `row-${slot}`] as const
}

function recentQueryRowPath(slot: number) {
  return [RECENT_QUERY_FOCUS_ID, RECENT_QUERY_AREA_ID, `query-${slot}`] as const
}

function resultsTableCellPath(rowSlot: number, cellSlot: number) {
  return [RESULTS_TABLE_FOCUS_ID, RESULTS_TABLE_GRID_AREA_ID, `row-${rowSlot}`, `cell-${cellSlot}`] as const
}

function captureFrameLines(ui: RenderedUi) {
  return ui.captureCharFrame().split("\n")
}

function findLine(lines: string[], text: string) {
  return lines.find((line) => line.includes(text))
}

function findLineIndex(lines: string[], text: string) {
  return lines.findIndex((line) => line.includes(text))
}

function expectTextOrder(line: string | undefined, segments: readonly string[]) {
  expect(line).toBeDefined()

  let previousIndex = -1
  for (const segment of segments) {
    const nextIndex = line!.indexOf(segment)
    expect(nextIndex).toBeGreaterThan(previousIndex)
    previousIndex = nextIndex
  }
}

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

async function settleRenderedUi(
  ui: RenderedUi,
  options: {
    delayMs?: number
    renders?: number
  } = {},
) {
  const { delayMs = 0, renders = 1 } = options

  await act(async () => {
    if (delayMs > 0) {
      await Bun.sleep(delayMs)
    }

    for (let index = 0; index < renders; index += 1) {
      await ui.renderOnce()
    }
  })
}

async function pressBackspaceRepeated(ui: RenderedUi, count: number) {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      ui.mockInput.pressBackspace()
      await ui.renderOnce()
      await ui.renderOnce()
    }
  })
}

async function typeTextSteadily(ui: RenderedUi, text: string) {
  await act(async () => {
    for (const char of text) {
      await ui.mockInput.typeText(char)
      await ui.renderOnce()
      await ui.renderOnce()
    }
  })
}

afterEach(() => {
  rendered?.renderer.destroy()
  rendered = undefined
  focusedPath = ""
  highlightedPath = ""
  focusNavigationActive = false
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

  test("wraps sidebar shortcuts instead of shrinking them in narrow widths", async () => {
    const stub = createEngineStub({
      connections: createQueryState({
        data: [],
        dataUpdateCount: 1,
        status: "success",
      }),
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
      { height: 12, width: 24 },
    )

    const frame = ui.captureCharFrame()
    const shortcutLines = frame
      .split("\n")
      .filter((line) => line.includes("Add Conn") || line.includes("Settings") || line.includes("Refresh"))

    expect(frame).toContain("Add Conn")
    expect(frame).toContain("Settings")
    expect(frame).toContain("Refresh")
    expect(shortcutLines.length).toBeGreaterThan(1)
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
              name: "users_name_idx",
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

    const frame = ui.captureCharFrame()
    const lines = frame.split("\n")
    const connectionLine = findLine(lines, connection.name)
    expect(frame).toContain(connection.name)
    expect(frame).toContain(connection.protocol)
    expect(frame).toContain("Refresh")
    expect(frame).not.toContain(`(${connection.protocol})`)
    expectTextOrder(connectionLine, [connection.name, "main", connection.protocol])
    expect(findLineIndex(lines, connection.name)).toBeLessThan(findLineIndex(lines, "schema public"))
    expect(frame).toContain("schema public")
    expect(frame).toContain("users")
    expect(frame).toContain("tbl")
    expect(frame).toContain("view active_users")
    expect(frame).toContain("matview latest_users")
    expect(lines.some((line) => line.includes("users_name_idx"))).toBe(false)
    expect(lines.some((line) => line.includes("trigger on users"))).toBe(false)

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

  test("refreshes the focused connection branch from the sidebar refresh shortcut", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-refresh",
      name: "Refresh Memory",
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
            { database: "main", name: "users", schema: undefined, type: "table" },
          ],
          dataUpdateCount: 1,
          status: "success",
        }),
      },
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => undefined} />
        <FocusController path={sidebarRowPath(0)} />
      </SqlVisorProvider>,
      { height: 16, width: 100 },
    )

    await settleRenderedUi(ui, { renders: 2 })

    expect(ui.captureCharFrame()).toContain("Refresh")

    await act(async () => {
      ui.mockInput.pressKey("r")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(stub.calls.loadConnectionObjects).toEqual([connection.id])

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressKey("r")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(stub.calls.loadConnectionObjects).toEqual([connection.id, connection.id])
  })

  test("collapses a single database row into the connection row", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      name: "Mem",
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
            { database: "main", name: "some_table", schema: undefined, type: "table" },
          ],
          dataUpdateCount: 1,
          status: "success",
        }),
      },
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
      { height: 12, width: 80 },
    )

    const lines = captureFrameLines(ui)
    const connectionLine = findLine(lines, connection.name)
    const tableLine = findLine(lines, "some_table")

    expectTextOrder(connectionLine, [connection.name, "main", connection.protocol])
    expect(findLineIndex(lines, connection.name)).toBeLessThan(findLineIndex(lines, "some_table"))
    expect(tableLine?.indexOf("some_table") ?? -1).toBeGreaterThan(connectionLine?.indexOf(connection.name) ?? -1)
    expect(lines.some((line) => line.includes("main") && !line.includes(connection.name))).toBe(false)
  })

  test("keeps loaded connection branches attached to their own sections", async () => {
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
          data: [{ name: "main", type: "database" }],
          dataUpdateCount: 1,
          status: "success",
        }),
        [second.id]: createQueryState({
          data: [{ name: "main", type: "database" }],
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

    const frame = ui.captureCharFrame()
    expect(frame).toContain(first.name)
    expect(frame).toContain(second.name)
    expect(frame.split("\n").find((line) => line.includes(first.name))).toContain("main")
    expect(frame.split("\n").find((line) => line.includes(second.name))).toContain("main")
  })

  test("renders empty object branches as empty folders instead of placeholder rows", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      name: "Mem",
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
          data: [],
          dataUpdateCount: 1,
          status: "success",
        }),
      },
      selectedConnectionId: connection.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => undefined} />
      </SqlVisorProvider>,
      { height: 12, width: 80 },
    )

    const frame = ui.captureCharFrame()
    expect(frame).toContain("󰉖")
    expect(frame).toContain(connection.name)
    expect(frame).not.toContain("(no objects found)")
  })

  test("wraps sidebar focus around the whole sidebar and delegates into the tree", async () => {
    const first = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-first",
      name: "First Memory",
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
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <Sidebar onAddConnection={() => undefined} />
        <FocusController path={[SIDEBAR_AREA_ID]} />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 16, width: 80 },
    )

    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(0)) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(1)) ?? "")
  })

  test("confirms connection deletion from backspace on a focused sidebar connection", async () => {
    const first = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-first",
      name: "First Memory",
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
      selectedConnectionId: first.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
        <FocusController path={sidebarRowPath(0)} />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 20, width: 100 },
    )

    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(0)) ?? "")

    ui.mockInput.pressBackspace()
    await settleRenderedUi(ui, { delayMs: 80, renders: 3 })

    expect(ui.captureCharFrame()).toContain(`Delete connection "${first.name}"?`)
    expect(ui.captureCharFrame()).toContain("Cancel")
    expect(ui.captureCharFrame()).toContain("Delete")

    await act(async () => {
      ui.mockInput.pressEscape()
      await Bun.sleep(35)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(stub.calls.deleteConnection).toEqual([])
    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(0)) ?? "")

    ui.mockInput.pressBackspace()
    await settleRenderedUi(ui, { delayMs: 80, renders: 3 })

    await act(async () => {
      ui.mockInput.pressKey("d")
      await Bun.sleep(80)
      await ui.renderOnce()
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(stub.calls.deleteConnection).toEqual([first.id])
    expect(ui.captureCharFrame()).not.toContain(first.name)
    expect(ui.captureCharFrame()).toContain(second.name)
    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(0)) ?? "")
  })

  test("activating the sidebar from focus navigation delegates into its first row on launch", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      id: "conn-focus-nav",
      name: "Focus Nav Memory",
      protocol: "bunsqlite",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 24, width: 100 },
    )

    await act(async () => {
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

    await act(async () => {
      ui.mockInput.pressArrow("left")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(highlightedPath).toBe(focusPathSignature([SIDEBAR_AREA_ID]) ?? "")

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusNavigationActive).toBe(false)
    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(0)) ?? "")
  })

  test("renders row detail views in the app", async () => {
    const connection = makeConnection({
      config: {
        path: ":memory:",
      },
      protocol: "bunsqlite",
    })
    const queryExecution = makeQueryExecution({
      connectionId: connection.id,
      id: "history-1",
      rows: [{ id: 1, name: "Ada" }],
      sql: "select * from users",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      history: [queryExecution],
      queryExecution: createQueryState({
        data: queryExecution,
        dataUpdateCount: 1,
        status: "success",
      }),
      selectedConnectionId: connection.id,
      selectedQueryExecutionId: queryExecution.id,
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
    const pendingEntry = makeQueryExecution({
      connectionId: connection.id,
      id: "query-1",
      sql: "select 1",
      status: "pending",
    })
    const fetchingStub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      history: [pendingEntry],
      queryExecution: createQueryState({
        data: pendingEntry,
        dataUpdateCount: 1,
        fetchStatus: "fetching",
        status: "pending",
      }),
      selectedConnectionId: connection.id,
      selectedQueryExecutionId: pendingEntry.id,
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
        history: [failedEntry, restorableEntry],
        editor: {
          buffer: {
            text: "select 1",
          },
        },
        queryExecution: createQueryState({
          data: failedEntry,
          dataUpdateCount: 1,
          error: new Error("query failed"),
          errorUpdateCount: 1,
          fetchStatus: "idle",
          status: "error",
        }),
        selectedConnectionId: connection.id,
        selectedQueryExecutionId: failedEntry.id,
      },
      {
        restoreQueryExecution(entryId) {
          const entry = [restorableEntry, failedEntry].find((candidate) => candidate.id === entryId)
          if (!entry) {
            return
          }

          stub.setState({
            editor: {
              buffer: {
                cursorOffset: entry.sql.source.length,
                text: entry.sql.source,
              },
            },
            queryExecution: createQueryState({
              data: entry,
              dataUpdateCount: 1,
              error: entry.status === "success" ? null : new Error(entry.error ?? "query failed"),
              errorUpdateCount: entry.status === "success" ? 0 : 1,
              fetchStatus: entry.status === "pending" ? "fetching" : "idle",
              status: entry.status === "pending" ? "pending" : entry.status === "success" ? "success" : "error",
            }),
            selectedConnectionId: entry.connectionId,
            selectedQueryExecutionId: entry.id,
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
        buffer: {
          cursorOffset: "select ".length,
          text: "select ",
        },
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

    expect(stub.getState().editor.buffer.text).toBe("select x")
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
    const activeEntry = makeQueryExecution({
      connectionId: connection.id,
      id: "query-4",
      sql: "select 4",
      status: "pending",
    })
    const stub = createEngineStub({
      connections: createQueryState({
        data: [connection],
        dataUpdateCount: 1,
        status: "success",
      }),
      history: [systemFinished, newestFinished, failedFinished, oldestFinished, activeEntry],
      queryExecution: createQueryState({
        data: activeEntry,
        dataUpdateCount: 1,
        fetchStatus: "fetching",
        status: "pending",
      }),
      selectedConnectionId: connection.id,
      selectedQueryExecutionId: activeEntry.id,
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
        <FocusController path={recentQueryRowPath(0)} />
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
    expect(focusedPath).toBe(focusPathSignature(recentQueryRowPath(0)) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    expect(focusedPath).toBe(focusPathSignature(recentQueryRowPath(1)) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
    })
    expect(focusedPath).toBe(focusPathSignature(recentQueryRowPath(2)) ?? "")
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

    expect(focusedPath).toBe(focusPathSignature(recentQueryRowPath(2)) ?? "")
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
        <FocusController path={recentQueryRowPath(0)} />
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

    expect(focusedPath).toBe(focusPathSignature(resultsTableCellPath(0, 0)) ?? "")
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
    expect(ui.captureCharFrame()).toContain("esc")
    expect(ui.captureCharFrame()).not.toContain("esc esc")
    expect(ui.captureCharFrame()).toContain("Protocol")
    expect(ui.captureCharFrame()).toContain("Connection Name")
    expect(ui.captureCharFrame()).toContain("◉ bunsqlite")
    expect(ui.captureCharFrame()).toContain("○ postgresql")
    expect(ui.captureCharFrame()).toContain("○ turso")

    const protocolLine = ui.captureSpans().lines.find((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .includes("◉ bunsqlite"),
    )
    const protocolBackgroundWidth =
      protocolLine?.spans.filter((span) => span.bg.a > 0).reduce((width, span) => width + span.width, 0) ?? 0

    expect(protocolBackgroundWidth).toBeGreaterThan("◉ bunsqlite  ○ turso  ○ postgresql".length)
  })

  test("opens add connection from a sidebar suggestion with prefilled values", async () => {
    const suggestion = {
      config: {
        database: "postgres",
        host: "localhost",
        port: 15432,
      },
      id: "suggestion-postgres-local",
      name: "localhost:15432",
      protocol: "postgresql" as const,
    }
    const stub = createEngineStub({
      connectionSuggestions: createQueryState({
        data: [suggestion],
        dataUpdateCount: 1,
        status: "success",
      }),
      connections: createQueryState({
        data: [],
        dataUpdateCount: 1,
        status: "success",
      }),
    })

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <App />
        <FocusController path={sidebarRowPath(0)} />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 32, width: 120 },
    )
    await settleRenderedUi(ui, { renders: 2 })

    expect(ui.captureCharFrame()).toContain("Suggestions")
    expect(ui.captureCharFrame()).toContain("localhost:15432")
    expect(ui.captureCharFrame()).not.toContain("No connections yet. Use the public API or add one next.")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(sidebarRowPath(1)) ?? "")

    await act(async () => {
      ui.mockInput.pressEnter()
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleRenderedUi(ui, { renders: 2 })

    const frame = ui.captureCharFrame()
    expect(frame).toContain("Add Connection")
    expect(frame).toContain("◉ postgresql")
    expect(frame).toContain("Connection Name")
    expect(frame).toContain("localhost:15432")
    expect(frame).toContain("//localhost:15432/postgres?sslmode=disable")
    expect(frame).toContain("Host")
    expect(frame).toContain("postgres")
    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("name")) ?? "")

    await act(async () => {
      ui.mockInput.pressTab({ shift: true })
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleRenderedUi(ui, { renders: 2 })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("protocol")) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("left")
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleRenderedUi(ui, { renders: 2 })

    expect(ui.captureCharFrame()).toContain("◉ postgresql")
    expect(ui.captureCharFrame()).not.toContain("◉ bunsqlite")
  })

  test("syncs URI input with adapter fields when a connection spec provides URI helpers", async () => {
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
    const pastedURI = "postgresql://alice@db:6543/base?ssl=true&application_name=sqlv"
    const updatedURI = "postgresql://alice@db2:6543/base?application_name=sqlv&ssl=true"

    const ui = await render(
      <SqlVisorProvider engine={stub.engine}>
        <AddConnectionPane onSaved={() => undefined} />
        <FocusProbe />
      </SqlVisorProvider>,
      { height: 28, width: 160 },
    )

    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("name")) ?? "")

    await act(async () => {
      ui.mockInput.pressTab({ shift: true })
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleRenderedUi(ui, { renders: 2 })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("protocol")) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("left")
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleRenderedUi(ui, { renders: 2 })

    expect(ui.captureCharFrame()).toContain("Connection URI")
    expect(ui.captureCharFrame()).toContain(defaultPostgresURI)

    await act(async () => {
      ui.mockInput.pressTab()
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("name")) ?? "")

    await act(async () => {
      ui.mockInput.pressTab()
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await pressBackspaceRepeated(ui, defaultPostgresURI.length)

    await act(async () => {
      await ui.mockInput.pasteBracketedText(pastedURI)
      await ui.renderOnce()
      await ui.renderOnce()
    })

    let frame = ui.captureCharFrame()
    expect(frame).toContain(pastedURI)
    expect(frame).toContain("db")
    expect(frame).toContain("6543")
    expect(frame).toContain("base")
    expect(frame).toContain("alice")
    expect(frame).toContain("sqlv")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await pressBackspaceRepeated(ui, "db".length)

    await act(async () => {
      await ui.mockInput.pasteBracketedText("db2")
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await settleRenderedUi(ui, { renders: 2 })

    frame = ui.captureCharFrame()
    expect(frame).toContain("db2")
    expect(frame).toContain(updatedURI)

    await act(async () => {
      ui.mockInput.pressArrow("up")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await typeTextSteadily(ui, "%")

    frame = ui.captureCharFrame()
    expect(frame).toContain(`${updatedURI}%`)
    expect(frame).toContain("db2")
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

  test("closes the add-connection modal on a single escape", async () => {
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
    await Bun.sleep(0)
    expect(focusNavigationActive).toBe(false)
    expect(ui.captureCharFrame()).not.toContain("Add Connection")
  })

  test("keeps focus on protocol while cycling adapters in the add-connection modal", async () => {
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

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("name")) ?? "")

    await act(async () => {
      ui.mockInput.pressTab({ shift: true })
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("protocol")) ?? "")
    expect(ui.captureCharFrame()).toContain("◉ bunsqlite")
    expect(ui.captureCharFrame()).toContain("○ postgresql")
    expect(ui.captureCharFrame()).toContain("○ turso")

    await act(async () => {
      ui.mockInput.pressArrow("right")
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await Bun.sleep(0)
    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("protocol")) ?? "")
    expect(ui.captureCharFrame()).toContain("◉ turso")
    expect(ui.captureCharFrame()).toContain("○ bunsqlite")
    expect(ui.captureCharFrame()).toContain("○ postgresql")
  })

  test("keeps add-connection field keybinds working after toggling a checkbox directly", async () => {
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
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusNavigationActive).toBe(false)
    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("readonly")) ?? "")

    const readonlyLine = ui.captureSpans().lines.find((line) => {
      const text = line.spans.map((span) => span.text).join("")
      const backgroundWidth = line.spans.filter((span) => span.bg.a > 0).reduce((width, span) => width + span.width, 0)
      return backgroundWidth > 0 && text.includes("Disabled")
    })
    const readonlyBackgroundWidth =
      readonlyLine?.spans.filter((span) => span.bg.a > 0).reduce((width, span) => width + span.width, 0) ?? 0

    expect(readonlyLine).toBeDefined()
    expect(readonlyBackgroundWidth).toBeGreaterThan("○ Disabled".length)

    await act(async () => {
      ui.mockInput.pressKey(" ")
      await ui.renderOnce()
      await ui.renderOnce()
    })
    await Bun.sleep(0)
    await act(async () => {
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(ui.captureCharFrame()).toContain("Enabled")
    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("readonly")) ?? "")

    await act(async () => {
      ui.mockInput.pressArrow("down")
      await ui.renderOnce()
      await ui.renderOnce()
    })

    expect(focusedPath).toBe(focusPathSignature(addConnectionInputPath("create")) ?? "")
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
        buffer: {
          text: "",
        },
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
    expect(stub.getState().editor.buffer.text).toBe("abc")
  })
})
