import { describe, expect, test } from "bun:test"

import { FocusTree } from "./FocusTree"
import { ROOT_FOCUS_PATH } from "./paths"

describe("FocusTree", () => {
  test("starts focus navigation from the currently focused node and moves spatially", () => {
    const tree = new FocusTree()
    tree.registerNode({
      id: "left",
      focusable: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 10, height: 3 }),
    })
    tree.registerNode({
      id: "right",
      focusable: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 20, y: 0, width: 10, height: 3 }),
    })

    tree.setFocusedPath(["left"])
    tree.startFocusNavigation()
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      highlightedPath: ["left"],
      focusedPath: ["left"],
    })

    tree.moveFocusNavigation("right")
    expect(tree.getNavigationState().highlightedPath).toEqual(["right"])
  })

  test("scopes movement to the innermost trapped area and routes escape to that area", () => {
    const tree = new FocusTree()
    let closeCount = 0

    tree.registerArea({
      id: "modal",
      parentPath: ROOT_FOCUS_PATH,
      trap: true,
      onTrapEsc: () => {
        closeCount += 1
      },
      trapEscLabel: "Close",
    })
    tree.registerNode({
      id: "inside",
      focusable: true,
      parentPath: ["modal"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 5, y: 5, width: 8, height: 3 }),
    })
    tree.registerNode({
      id: "outside",
      focusable: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 40, y: 5, width: 8, height: 3 }),
    })

    tree.setFocusedPath(["modal", "inside"])
    tree.startFocusNavigation()
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      activeScopePath: ["modal"],
      escLabel: "Close",
      highlightedPath: ["modal", "inside"],
    })

    tree.moveFocusNavigation("right")
    expect(tree.getNavigationState().highlightedPath).toEqual(["modal", "inside"])

    tree.handleEscape()
    expect(closeCount).toBe(1)
    expect(tree.getNavigationState().active).toBe(false)
  })

  test("captures reveal-driven snapshots once and restores them on cancel", () => {
    const tree = new FocusTree()
    let scrollPosition = 0
    let captureCount = 0

    tree.registerArea({
      id: "scroll",
      parentPath: ROOT_FOCUS_PATH,
      revealDescendant: () => {
        scrollPosition += 10
      },
      captureSnapshot: () => {
        captureCount += 1
        return scrollPosition
      },
      restoreSnapshot: (snapshot: unknown) => {
        scrollPosition = snapshot as number
      },
    })
    tree.registerNode({
      id: "top",
      focusable: true,
      parentPath: ["scroll"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 8, height: 3 }),
    })
    tree.registerNode({
      id: "bottom",
      focusable: true,
      parentPath: ["scroll"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 10, width: 8, height: 3 }),
    })

    tree.setFocusedPath(["scroll", "top"])
    tree.startFocusNavigation()
    tree.moveFocusNavigation("down")

    expect(captureCount).toBe(1)
    expect(scrollPosition).toBe(30)

    tree.cancelFocusNavigation()
    expect(scrollPosition).toBe(10)
    expect(tree.getNavigationState().active).toBe(false)
  })

  test("esc starts focus navigation from the current real focus", () => {
    const tree = new FocusTree()

    tree.registerNode({
      id: "gp",
      focusable: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 20, height: 3 }),
    })
    tree.registerNode({
      id: "cX",
      focusable: true,
      parentPath: ["gp"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 5, width: 20, height: 3 }),
    })
    tree.registerArea({
      id: "list",
      parentPath: ["gp", "cX"],
    })
    tree.registerNode({
      id: "l2",
      focusable: true,
      parentPath: ["gp", "cX", "list"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 10, width: 20, height: 3 }),
    })

    tree.setFocusedPath(["gp", "cX", "list", "l2"])

    tree.handleEscape()
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      focusedPath: ["gp", "cX", "list", "l2"],
      highlightedPath: ["gp", "cX", "list", "l2"],
    })

    tree.handleEscape()
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      focusedPath: ["gp", "cX", "list", "l2"],
      highlightedPath: ["gp", "cX"],
    })

    tree.handleEscape()
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      focusedPath: ["gp", "cX", "list", "l2"],
      highlightedPath: ["gp"],
    })
  })

  test("esc steps highlighted focus outward before closing a trapped area", () => {
    const tree = new FocusTree()
    let closeCount = 0

    tree.registerArea({
      id: "modal",
      parentPath: ROOT_FOCUS_PATH,
      trap: true,
      onTrapEsc: () => {
        closeCount += 1
      },
      trapEscLabel: "Close",
    })
    tree.registerNode({
      id: "cX",
      focusable: true,
      parentPath: ["modal"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 12, height: 3 }),
    })
    tree.registerArea({
      id: "list",
      parentPath: ["modal", "cX"],
    })
    tree.registerNode({
      id: "l2",
      focusable: true,
      parentPath: ["modal", "cX", "list"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 5, width: 12, height: 3 }),
    })

    tree.setFocusedPath(["modal", "cX", "list", "l2"])
    tree.startFocusNavigation()
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      activeScopePath: ["modal"],
      highlightedPath: ["modal", "cX", "list", "l2"],
      escLabel: "Close",
    })

    tree.handleEscape()
    expect(closeCount).toBe(0)
    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      activeScopePath: ["modal"],
      highlightedPath: ["modal", "cX"],
      focusedPath: ["modal", "cX", "list", "l2"],
      escLabel: "Close",
    })

    tree.handleEscape()
    expect(closeCount).toBe(1)
    expect(tree.getNavigationState().active).toBe(false)
  })

  test("flushPendingChanges resolves deferred focus requests after silent structural registration", () => {
    const tree = new FocusTree()
    let notificationCount = 0

    tree.subscribe(() => {
      notificationCount += 1
    })

    tree.registerNode({
      id: "table",
      focusable: true,
      delegatesFocus: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 20, height: 5 }),
    })

    expect(notificationCount).toBe(0)
    expect(tree.focusPath(["table"])).toBe(false)
    expect(notificationCount).toBe(0)

    tree.registerNode({
      id: "cell-0",
      focusable: true,
      navigable: false,
      parentPath: ["table"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 8, height: 3 }),
    })

    expect(notificationCount).toBe(0)
    expect(tree.flushPendingChanges()).toBe(true)
    expect(notificationCount).toBe(1)
    expect(tree.getNavigationState()).toMatchObject({
      active: false,
      focusedPath: ["table", "cell-0"],
      highlightedPath: ["table", "cell-0"],
    })
  })

  test("resolves nested delegated descendants for ordinary focus requests", () => {
    const tree = new FocusTree()

    tree.registerNode({
      id: "sidebar",
      focusable: true,
      delegatesFocus: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 20, height: 10 }),
    })
    tree.registerNode({
      id: "tree",
      focusable: true,
      delegatesFocus: true,
      parentPath: ["sidebar"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 1, width: 20, height: 9 }),
    })
    tree.registerNode({
      id: "row-0",
      focusable: true,
      navigable: false,
      parentPath: ["sidebar", "tree"],
      getViewportRect: () => ({ x: 0, y: 1, width: 20, height: 1 }),
    })

    expect(tree.focusPath(["sidebar"])).toBe(true)
    expect(tree.getNavigationState()).toMatchObject({
      active: false,
      focusedPath: ["sidebar", "tree", "row-0"],
      highlightedPath: ["sidebar", "tree", "row-0"],
    })
  })

  test("activating a highlighted delegated focusable resolves to its nested descendant", () => {
    const tree = new FocusTree()

    tree.registerNode({
      id: "sidebar",
      focusable: true,
      delegatesFocus: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 20, height: 10 }),
    })
    tree.registerNode({
      id: "tree",
      focusable: true,
      delegatesFocus: true,
      parentPath: ["sidebar"],
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 1, width: 20, height: 9 }),
    })
    tree.registerNode({
      id: "row-0",
      focusable: true,
      navigable: false,
      parentPath: ["sidebar", "tree"],
      getViewportRect: () => ({ x: 0, y: 1, width: 20, height: 1 }),
    })
    tree.registerNode({
      id: "editor",
      focusable: true,
      parentPath: ROOT_FOCUS_PATH,
      applyFocus: () => undefined,
      getViewportRect: () => ({ x: 30, y: 0, width: 40, height: 10 }),
    })

    tree.setFocusedPath(["editor"])
    tree.startFocusNavigation()
    tree.moveFocusNavigation("left")

    expect(tree.getNavigationState()).toMatchObject({
      active: true,
      focusedPath: ["editor"],
      highlightedPath: ["sidebar"],
    })

    tree.activateHighlightedFocusable()

    expect(tree.getNavigationState()).toMatchObject({
      active: false,
      focusedPath: ["sidebar", "tree", "row-0"],
      highlightedPath: ["sidebar", "tree", "row-0"],
    })
  })
})
