import { chooseNextFocusNavigable, type MeasuredFocusNode } from "./navigation"
import { focusPathAncestors, focusPathKey, isAncestorFocusPath, ROOT_FOCUS_PATH, sameFocusPath } from "./paths"
import type {
  FocusAreaRegistration,
  FocusDirection,
  FocusNavigablePath,
  FocusNavigationSnapshot,
  FocusNavigationState,
  FocusNodeRegistration,
  FocusRect,
  FocusRevealOptions,
  FocusTreeSnapshot,
  FocusVisibleRect,
} from "./types"

type FocusAreaRecord = {
  path: FocusNavigablePath
  order: number
  input: FocusAreaRegistration
}

type FocusNodeRecord = {
  path: FocusNavigablePath
  order: number
  input: FocusNodeRegistration
}

type CapturedSnapshot = {
  path: FocusNavigablePath
  snapshot: FocusNavigationSnapshot
}

type FocusNavigationSession = {
  activeScopePath: FocusNavigablePath
  snapshots: Map<string, CapturedSnapshot>
}

type Listener = () => void

const DEFAULT_REVEAL_OPTIONS: FocusRevealOptions = {
  axis: "both",
  align: "nearest",
}

export class FocusTree {
  #areas = new Map<string, FocusAreaRecord>()
  #nodes = new Map<string, FocusNodeRecord>()
  #listeners = new Set<Listener>()
  #nextOrder = 0
  #focusedPath: FocusNavigablePath | undefined
  #highlightedPath: FocusNavigablePath | undefined
  #session: FocusNavigationSession | undefined
  #navigationState: FocusNavigationState = {
    active: false,
    focusedPath: undefined,
    highlightedPath: undefined,
    activeScopePath: ROOT_FOCUS_PATH,
    escLabel: undefined,
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getNavigationState(): FocusNavigationState {
    return this.#navigationState
  }

  getSnapshot(): FocusTreeSnapshot {
    return {
      ...this.#navigationState,
      areas: [...this.#areas.values()]
        .sort((a, b) => a.order - b.order)
        .map((area) => ({
          path: area.path,
          parentPath: area.input.parentPath,
          trap: area.input.trap ?? false,
          hasViewportRect: area.input.getViewportRect !== undefined,
          hasViewportClipRect: area.input.getViewportClipRect !== undefined,
          hasRevealDescendant: area.input.revealDescendant !== undefined,
          hasOnEsc: area.input.onEsc !== undefined,
          order: area.order,
        })),
      nodes: [...this.#nodes.values()]
        .sort((a, b) => a.order - b.order)
        .map((node) => ({
          path: node.path,
          parentPath: node.input.parentPath,
          disabled: node.input.disabled ?? false,
          order: node.order,
        })),
      capturedSnapshotPaths: [...(this.#session?.snapshots.values() ?? [])].map((entry) => entry.path),
    }
  }

  #computeNavigationState(): FocusNavigationState {
    const activeScopePath = this.#session?.activeScopePath ?? this.#computeScopePath()
    const scopeArea = this.#getArea(activeScopePath)
    return {
      active: this.#session !== undefined,
      focusedPath: this.#focusedPath,
      highlightedPath: this.#highlightedPath,
      activeScopePath,
      escLabel: scopeArea?.input.trap ? scopeArea.input.onEscLabel : undefined,
    }
  }

  registerArea(input: FocusAreaRegistration): FocusNavigablePath {
    const path = freezePath(input.parentPath, input.id)
    this.#assertPathAvailable(path)
    this.#areas.set(requirePathKey(path), {
      path,
      order: this.#nextOrder++,
      input,
    })
    this.#notify()
    return path
  }

  updateArea(path: FocusNavigablePath, patch: Partial<FocusAreaRegistration>) {
    const area = this.#getArea(path)
    if (!area) {
      return
    }
    area.input = { ...area.input, ...patch }
    this.#notify()
  }

  unregisterArea(path: FocusNavigablePath) {
    this.#areas.delete(requirePathKey(path))
    if (sameFocusPath(this.#highlightedPath, path) || isAncestorFocusPath(path, this.#highlightedPath)) {
      this.#highlightedPath = undefined
    }
    this.#notify()
  }

  registerNode(input: FocusNodeRegistration): FocusNavigablePath {
    const path = freezePath(input.parentPath, input.id)
    this.#assertPathAvailable(path)
    this.#nodes.set(requirePathKey(path), {
      path,
      order: this.#nextOrder++,
      input,
    })
    this.#notify()
    return path
  }

  updateNode(path: FocusNavigablePath, patch: Partial<FocusNodeRegistration>) {
    const node = this.#getNode(path)
    if (!node) {
      return
    }
    node.input = { ...node.input, ...patch }
    this.#notify()
  }

  unregisterNode(path: FocusNavigablePath) {
    this.#nodes.delete(requirePathKey(path))
    if (sameFocusPath(this.#focusedPath, path)) {
      this.#focusedPath = undefined
    }
    if (sameFocusPath(this.#highlightedPath, path)) {
      this.#highlightedPath = undefined
    }
    this.#notify()
  }

  setFocusedPath(path: FocusNavigablePath | undefined) {
    if (path && !this.#nodes.has(requirePathKey(path))) {
      return
    }
    if (sameFocusPath(this.#focusedPath, path)) {
      return
    }
    this.#focusedPath = path
    this.#notify()
  }

  setHighlightedPath(path: FocusNavigablePath | undefined) {
    if (path && !this.#nodes.has(requirePathKey(path))) {
      return
    }
    if (sameFocusPath(this.#highlightedPath, path)) {
      return
    }
    this.#highlightedPath = path
    this.#notify()
  }

  focusPath(path: FocusNavigablePath): boolean {
    const node = this.#getNode(path)
    if (!node || node.input.disabled) {
      return false
    }
    node.input.focus()
    this.#focusedPath = path
    this.#highlightedPath = path
    this.#session = undefined
    this.#notify()
    return true
  }

  startFocusNavigation() {
    if (this.#session) {
      return
    }
    const activeScopePath = this.#computeScopePath()
    const highlightedPath = this.#chooseInitialHighlightedPath(activeScopePath)
    if (!highlightedPath) {
      return
    }
    this.#session = {
      activeScopePath,
      snapshots: new Map<string, CapturedSnapshot>(),
    }
    this.#highlightedPath = highlightedPath
    this.#revealDescendant(highlightedPath)
    this.#notify()
  }

  cancelFocusNavigation() {
    const session = this.#session
    if (!session) {
      return
    }

    const snapshots = [...session.snapshots.values()].sort(
      (a, b) => b.path.length - a.path.length || comparePathStrings(a.path, b.path),
    )

    for (const entry of snapshots) {
      const participant = this.#getParticipant(entry.path)
      participant?.restoreFocusNavigationSnapshot?.(entry.snapshot)
    }

    this.#session = undefined
    this.#notify()
  }

  handleEscape() {
    const session = this.#session
    if (!session) {
      this.startFocusNavigation()
      return
    }

    const area = this.#getArea(session.activeScopePath)
    area?.input.onEsc?.()
    this.cancelFocusNavigation()
  }

  activateHighlightedFocusNavigable() {
    if (!this.#session) {
      return
    }

    const highlightedPath = this.#resolveHighlightedPath()
    if (!highlightedPath) {
      return
    }

    const node = this.#getNode(highlightedPath)
    if (!node || node.input.disabled) {
      return
    }

    node.input.focus()
    this.#focusedPath = highlightedPath
    this.#highlightedPath = highlightedPath
    this.#session = undefined
    this.#notify()
  }

  moveFocusNavigation(direction: FocusDirection) {
    const session = this.#session
    if (!session) {
      return
    }

    const currentPath = this.#resolveHighlightedPath()
    if (!currentPath) {
      const fallback = this.#firstVisibleNodeInScope(session.activeScopePath)
      if (!fallback) {
        return
      }
      this.#highlightedPath = fallback.path
      this.#revealDescendant(fallback.path)
      this.#notify()
      return
    }

    const current = this.#measureNode(currentPath)
    if (!current) {
      return
    }

    const candidates = this.#collectMeasuredNodes(session.activeScopePath).filter(
      (candidate) => !sameFocusPath(candidate.path, current.path),
    )
    const next = chooseNextFocusNavigable(current, candidates, direction)
    if (!next || sameFocusPath(next.path, this.#highlightedPath)) {
      return
    }

    this.#highlightedPath = next.path
    this.#revealDescendant(next.path)
    this.#notify()
  }

  #resolveHighlightedPath(): FocusNavigablePath | undefined {
    const session = this.#session
    if (!session) {
      return undefined
    }

    const highlightedPath = this.#highlightedPath
    if (
      highlightedPath &&
      this.#nodes.has(requirePathKey(highlightedPath)) &&
      this.#measureNode(highlightedPath) &&
      this.#isPathInScope(highlightedPath, session.activeScopePath)
    ) {
      return highlightedPath
    }

    const fallback = this.#firstVisibleNodeInScope(session.activeScopePath)
    if (!fallback) {
      return undefined
    }

    this.#highlightedPath = fallback.path
    return fallback.path
  }

  #chooseInitialHighlightedPath(activeScopePath: FocusNavigablePath): FocusNavigablePath | undefined {
    if (this.#focusedPath && this.#isNodeVisibleInScope(this.#focusedPath, activeScopePath)) {
      return this.#focusedPath
    }

    if (this.#highlightedPath && this.#isNodeVisibleInScope(this.#highlightedPath, activeScopePath)) {
      return this.#highlightedPath
    }

    return this.#firstVisibleNodeInScope(activeScopePath)?.path
  }

  #computeScopePath(): FocusNavigablePath {
    const basePath = this.#focusedPath ?? this.#highlightedPath
    if (!basePath) {
      return ROOT_FOCUS_PATH
    }

    let activeScopePath = ROOT_FOCUS_PATH
    for (const ancestor of focusPathAncestors(basePath)) {
      const area = this.#getArea(ancestor)
      if (area?.input.trap) {
        activeScopePath = ancestor
      }
    }
    return activeScopePath
  }

  #firstVisibleNodeInScope(activeScopePath: FocusNavigablePath): MeasuredFocusNode | undefined {
    return this.#collectMeasuredNodes(activeScopePath)[0]
  }

  #collectMeasuredNodes(activeScopePath: FocusNavigablePath): MeasuredFocusNode[] {
    const nodes: MeasuredFocusNode[] = []
    for (const node of this.#nodes.values()) {
      if (!this.#isPathInScope(node.path, activeScopePath) || node.input.disabled) {
        continue
      }
      const rect = this.#resolveNodeRect(node.path)
      if (!rect) {
        continue
      }
      nodes.push({
        path: node.path,
        rect,
        order: node.order,
      })
    }
    nodes.sort((a, b) => a.order - b.order)
    return nodes
  }

  #measureNode(path: FocusNavigablePath): MeasuredFocusNode | undefined {
    const node = this.#getNode(path)
    if (!node || node.input.disabled) {
      return undefined
    }
    const rect = this.#resolveNodeRect(path)
    if (!rect) {
      return undefined
    }
    return {
      path,
      rect,
      order: node.order,
    }
  }

  #resolveNodeRect(path: FocusNavigablePath): FocusRect | undefined {
    const node = this.#getNode(path)
    const baseRect = node?.input.getViewportRect()
    if (!node || !baseRect) {
      return undefined
    }

    let rect: FocusVisibleRect = { ...baseRect }
    for (const ancestor of focusPathAncestors(path)) {
      const area = this.#getArea(ancestor)
      const clip = area?.input.getViewportClipRect?.()
      if (!clip) {
        continue
      }
      rect = intersectRects(rect, clip)
      if (!rect) {
        return undefined
      }
    }

    return rect.width > 0 && rect.height > 0 ? rect : undefined
  }

  #isNodeVisibleInScope(path: FocusNavigablePath, activeScopePath: FocusNavigablePath): boolean {
    return this.#isPathInScope(path, activeScopePath) && this.#resolveNodeRect(path) !== undefined
  }

  #isPathInScope(path: FocusNavigablePath, activeScopePath: FocusNavigablePath): boolean {
    return sameFocusPath(activeScopePath, ROOT_FOCUS_PATH) || isAncestorFocusPath(activeScopePath, path)
  }

  #revealDescendant(descendantPath: FocusNavigablePath) {
    const session = this.#session
    if (!session) {
      return
    }

    for (let i = descendantPath.length - 1; i >= 1; i -= 1) {
      const areaPath = descendantPath.slice(0, i)
      const area = this.#getArea(areaPath)
      if (!area?.input.revealDescendant) {
        continue
      }
      this.#captureSnapshot(area.path)
      area.input.revealDescendant(descendantPath, DEFAULT_REVEAL_OPTIONS)
    }
  }

  #captureSnapshot(path: FocusNavigablePath) {
    const session = this.#session
    const key = focusPathKey(path)
    if (!session || !key || session.snapshots.has(key)) {
      return
    }

    const participant = this.#getParticipant(path)
    if (!participant?.captureFocusNavigationSnapshot || !participant.restoreFocusNavigationSnapshot) {
      return
    }

    session.snapshots.set(key, {
      path,
      snapshot: participant.captureFocusNavigationSnapshot(),
    })
  }

  #getArea(path: FocusNavigablePath): FocusAreaRecord | undefined {
    return this.#areas.get(requirePathKey(path))
  }

  #getNode(path: FocusNavigablePath): FocusNodeRecord | undefined {
    return this.#nodes.get(requirePathKey(path))
  }

  #getParticipant(path: FocusNavigablePath): {
    captureFocusNavigationSnapshot?: () => FocusNavigationSnapshot
    restoreFocusNavigationSnapshot?: (snapshot: FocusNavigationSnapshot) => void
  } | undefined {
    return this.#getArea(path)?.input ?? this.#getNode(path)?.input
  }

  #assertPathAvailable(path: FocusNavigablePath) {
    const key = requirePathKey(path)
    if (this.#areas.has(key) || this.#nodes.has(key)) {
      throw new Error(`Duplicate focus navigable path: ${path.join(" / ")}`)
    }
  }

  #notify() {
    this.#navigationState = this.#computeNavigationState()
    for (const listener of this.#listeners) {
      listener()
    }
  }
}

function freezePath(parentPath: FocusNavigablePath, id: string): FocusNavigablePath {
  return Object.freeze([...parentPath, id])
}

function requirePathKey(path: FocusNavigablePath): string {
  const key = focusPathKey(path)
  if (!key) {
    return ""
  }
  return key
}

function intersectRects(a: FocusRect, b: FocusRect): FocusVisibleRect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) {
    return null
  }
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

function comparePathStrings(a: FocusNavigablePath, b: FocusNavigablePath): number {
  return a.join("\u001f").localeCompare(b.join("\u001f"))
}
