import { describe, expect, test } from "bun:test"
import { FocusTree } from "../../src/lib/focus/FocusTree"
import { ROOT_FOCUS_PATH } from "../../src/lib/focus/paths"

describe("FocusTree", () => {
  test("starts focus navigation from the currently focused node and moves spatially", () => {
    const tree = new FocusTree()
    tree.registerNode({
      id: "left",
      parentPath: ROOT_FOCUS_PATH,
      focus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 10, height: 3 }),
    })
    tree.registerNode({
      id: "right",
      parentPath: ROOT_FOCUS_PATH,
      focus: () => undefined,
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
      onEsc: () => {
        closeCount += 1
      },
      onEscLabel: "Close",
    })
    tree.registerNode({
      id: "inside",
      parentPath: ["modal"],
      focus: () => undefined,
      getViewportRect: () => ({ x: 5, y: 5, width: 8, height: 3 }),
    })
    tree.registerNode({
      id: "outside",
      parentPath: ROOT_FOCUS_PATH,
      focus: () => undefined,
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
      captureFocusNavigationSnapshot: () => {
        captureCount += 1
        return scrollPosition
      },
      restoreFocusNavigationSnapshot: (snapshot) => {
        scrollPosition = snapshot as number
      },
    })
    tree.registerNode({
      id: "top",
      parentPath: ["scroll"],
      focus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 0, width: 8, height: 3 }),
    })
    tree.registerNode({
      id: "bottom",
      parentPath: ["scroll"],
      focus: () => undefined,
      getViewportRect: () => ({ x: 0, y: 10, width: 8, height: 3 }),
    })

    tree.setFocusedPath(["scroll", "top"])
    tree.startFocusNavigation()
    tree.moveFocusNavigation("down")

    expect(captureCount).toBe(1)
    expect(scrollPosition).toBe(20)

    tree.cancelFocusNavigation()
    expect(scrollPosition).toBe(0)
    expect(tree.getNavigationState().active).toBe(false)
  })
})
