import { chooseNextFocusNavigable, type MeasuredFocusNode } from "./navigation"
import {
  focusPathAncestors,
  focusPathKey,
  isAncestorFocusPath,
  ROOT_FOCUS_PATH,
  sameFocusPath,
} from "./paths"
import {
  normalizeFocusableRegistration,
  type FocusAreaRegistration,
  type FocusApplyReason,
  type FocusDirection,
  type FocusNavigationState,
  type FocusNodeRegistration,
  type FocusPath,
  type FocusPathSuffix,
  type FocusRect,
  type FocusRevealOptions,
  type FocusSnapshot,
  type FocusTreeSnapshot,
  type FocusVisibleRect,
  type FocusableRegistration,
  type NormalizedFocusableRegistration,
} from "./types"

type FocusableRecord = {
  path: FocusPath
  order: number
  input: NormalizedFocusableRegistration
}

type CapturedSnapshot = {
  path: FocusPath
  snapshot: FocusSnapshot
}

type FocusNavigationSession = {
  activeScopePath: FocusPath
  snapshots: Map<string, CapturedSnapshot>
}

type PendingFocusRequest = {
  path: FocusPath
  reason: FocusApplyReason
}

type Listener = () => void

const DEFAULT_REVEAL_OPTIONS: FocusRevealOptions = {
  axis: "both",
  align: "nearest",
}

export class FocusTree {
  #focusables = new Map<string, FocusableRecord>()
  #listeners = new Set<Listener>()
  #nextOrder = 0
  #focusedPath: FocusPath | undefined
  #highlightedPath: FocusPath | undefined
  #session: FocusNavigationSession | undefined
  #pendingFocusRequest: PendingFocusRequest | undefined
  #rememberedDescendantByPathKey = new Map<string, FocusPath>()
  #rememberedRevision = 0
  #lastNotifiedRememberedRevision = 0
  #hasPendingStructuralChanges = false
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
      focusables: [...this.#focusables.values()]
        .sort((a, b) => a.order - b.order)
        .map((focusable) => ({
          path: focusable.path,
          parentPath: focusable.input.parentPath,
          focusable: focusable.input.focusable,
          navigable: focusable.input.navigable,
          childrenNavigable: focusable.input.childrenNavigable,
          delegatesFocus: focusable.input.delegatesFocus,
          disabled: focusable.input.disabled,
          trap: focusable.input.trap ?? false,
          hasViewportRect: focusable.input.getViewportRect !== undefined,
          hasViewportClipRect: focusable.input.getViewportClipRect !== undefined,
          hasRevealDescendant: focusable.input.revealDescendant !== undefined,
          hasApplyFocus: focusable.input.applyFocus !== undefined,
          hasOnTrapEsc: focusable.input.onTrapEsc !== undefined,
          order: focusable.order,
        })),
      rememberedDescendantPaths: [...this.#rememberedDescendantByPathKey.entries()]
        .map(([ancestorKey, rememberedPath]) => {
          const ancestorPath = this.#focusables.get(ancestorKey)?.path
          if (!ancestorPath) {
            return undefined
          }
          return {
            ancestorPath,
            rememberedPath,
          }
        })
        .filter((entry) => entry !== undefined),
      pendingFocusPath: this.#pendingFocusRequest?.path,
      capturedSnapshotPaths: [...(this.#session?.snapshots.values() ?? [])].map((entry) => entry.path),
    }
  }

  registerFocusable(input: FocusableRegistration): FocusPath {
    const path = freezePath(input.parentPath, input.id)
    this.#assertPathAvailable(path)
    this.#focusables.set(requirePathKey(path), {
      path,
      order: this.#nextOrder++,
      input: normalizeFocusableRegistration(input),
    })
    this.#hasPendingStructuralChanges = true

    return path
  }

  registerArea(input: FocusAreaRegistration): FocusPath {
    return this.registerFocusable(input)
  }

  registerNode(input: FocusNodeRegistration): FocusPath {
    return this.registerFocusable(input)
  }

  updateFocusable(path: FocusPath, patch: Partial<FocusableRegistration>) {
    const focusable = this.#getFocusable(path)
    if (!focusable) {
      return
    }

    focusable.input = normalizeFocusableRegistration({
      ...focusable.input,
      ...patch,
      id: focusable.input.id,
      parentPath: focusable.input.parentPath,
    })
    this.#hasPendingStructuralChanges = true
  }

  updateArea(path: FocusPath, patch: Partial<FocusAreaRegistration>) {
    this.updateFocusable(path, patch)
  }

  updateNode(path: FocusPath, patch: Partial<FocusNodeRegistration>) {
    this.updateFocusable(path, patch)
  }

  unregisterFocusable(path: FocusPath) {
    this.#focusables.delete(requirePathKey(path))
    this.#deleteRememberedDescendant(requirePathKey(path))

    if (this.#focusedPath && isAncestorFocusPath(path, this.#focusedPath)) {
      this.#focusedPath = this.#findNearestAncestorFocusablePath(this.#focusedPath, ROOT_FOCUS_PATH)
    }

    if (this.#highlightedPath && isAncestorFocusPath(path, this.#highlightedPath)) {
      const scopePath = this.#session?.activeScopePath ?? ROOT_FOCUS_PATH
      this.#highlightedPath = this.#findNearestAncestorNavigablePath(
        this.#highlightedPath,
        scopePath,
        false,
      )
    }
    this.#hasPendingStructuralChanges = true
  }

  unregisterArea(path: FocusPath) {
    this.unregisterFocusable(path)
  }

  unregisterNode(path: FocusPath) {
    this.unregisterFocusable(path)
  }

  focusPath(path: FocusPath, reason: FocusApplyReason = "focus"): boolean {
    this.#pendingFocusRequest = {
      path,
      reason,
    }

    const resolved = this.#tryResolvePendingFocusRequest()
    if (resolved) {
      this.#emitIfObservableChanged()
    }
    return resolved
  }

  setFocusedPath(path: FocusPath | undefined): boolean {
    if (!path) {
      this.#pendingFocusRequest = undefined
      this.#session = undefined
      this.#focusedPath = undefined
      this.#highlightedPath = undefined
      this.#emitIfObservableChanged()
      return true
    }
    return this.focusPath(path)
  }

  setHighlightedPath(path: FocusPath | undefined): boolean {
    if (!path) {
      if (!this.#highlightedPath) {
        return false
      }
      this.#highlightedPath = undefined
      this.#emitIfObservableChanged()
      return true
    }

    if (!this.#isPathNavigableInScope(path, this.#session?.activeScopePath ?? ROOT_FOCUS_PATH)) {
      return false
    }

    if (sameFocusPath(this.#highlightedPath, path)) {
      return false
    }

    this.#highlightedPath = path
    if (this.#session) {
      this.#revealPath(path, true)
    }
    this.#emitIfObservableChanged()
    return true
  }

  getFocusedDescendantPath(path: FocusPath): FocusPath | undefined {
    return this.#descendantPathOrUndefined(path, this.#focusedPath)
  }

  getFocusedDescendantSubpath(path: FocusPath): FocusPathSuffix | undefined {
    return suffixForAncestor(path, this.getFocusedDescendantPath(path))
  }

  getHighlightedDescendantPath(path: FocusPath): FocusPath | undefined {
    return this.#descendantPathOrUndefined(path, this.#highlightedPath)
  }

  getHighlightedDescendantSubpath(path: FocusPath): FocusPathSuffix | undefined {
    return suffixForAncestor(path, this.getHighlightedDescendantPath(path))
  }

  getRememberedDescendantPath(path: FocusPath): FocusPath | undefined {
    const rememberedPath = this.#getRememberedFocusableDescendantPathWithin(path)
    return this.#descendantPathOrUndefined(path, rememberedPath)
  }

  getRememberedDescendantSubpath(path: FocusPath): FocusPathSuffix | undefined {
    return suffixForAncestor(path, this.getRememberedDescendantPath(path))
  }

  startFocusNavigation() {
    if (this.#session) {
      return
    }

    this.#pendingFocusRequest = undefined
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
    this.#revealPath(highlightedPath, true)
    this.#emitIfObservableChanged()
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
      const focusable = this.#getFocusable(entry.path)
      focusable?.input.restoreSnapshot?.(entry.snapshot)
    }

    this.#session = undefined
    this.#emitIfObservableChanged()
  }

  handleEscape() {
    const session = this.#session
    if (!session) {
      const activeScopePath = this.#computeScopePath()
      const parentPath = this.#focusedPath
        ? this.#findNearestAncestorFocusablePath(this.#focusedPath, activeScopePath)
        : undefined

      if (parentPath) {
        this.focusPath(parentPath, "escape")
        return
      }

      this.startFocusNavigation()
      return
    }

    const highlightedPath = this.#resolveHighlightedPath()
    const parentPath = highlightedPath
      ? this.#findNearestAncestorFocusablePath(highlightedPath, session.activeScopePath)
      : undefined

    if (parentPath) {
      this.#highlightedPath = parentPath
      this.#revealPath(parentPath, true)
      this.#emitIfObservableChanged()
      return
    }

    const scopeFocusable = this.#getFocusable(session.activeScopePath)
    scopeFocusable?.input.onTrapEsc?.()
    this.cancelFocusNavigation()
  }

  activateHighlightedFocusable() {
    if (!this.#session) {
      return
    }

    const highlightedPath = this.#resolveHighlightedPath()
    if (!highlightedPath) {
      return
    }

    this.#commitFocusPath(highlightedPath, "activate")
  }

  activateHighlightedFocusNavigable() {
    this.activateHighlightedFocusable()
  }

  moveFocusNavigation(direction: FocusDirection) {
    const session = this.#session
    if (!session) {
      return
    }

    const currentPath = this.#resolveHighlightedPath()
    if (!currentPath) {
      const fallback = this.#firstVisibleNavigableInScope(session.activeScopePath)
      if (!fallback) {
        return
      }
      this.#highlightedPath = fallback.path
      this.#revealPath(fallback.path, true)
      this.#emitIfObservableChanged()
      return
    }

    const current = this.#measureNavigablePath(currentPath)
    if (!current) {
      return
    }

    const candidates = this.#collectMeasuredNavigableFocusables(session.activeScopePath).filter(
      (candidate) => !sameFocusPath(candidate.path, current.path),
    )
    const next = chooseNextFocusNavigable(current, candidates, direction)
    if (!next || sameFocusPath(next.path, this.#highlightedPath)) {
      return
    }

    this.#highlightedPath = next.path
    this.#revealPath(next.path, true)
    this.#emitIfObservableChanged()
  }

  flushPendingChanges(): boolean {
    const hadPendingStructuralChanges = this.#hasPendingStructuralChanges
    this.#hasPendingStructuralChanges = false

    if (this.#pendingFocusRequest) {
      this.#tryResolvePendingFocusRequest()
    }

    if (hadPendingStructuralChanges) {
      this.#pruneInvalidRememberedDescendants()
      this.#repairFocusedPath()
      this.#repairHighlightedPath()
    }

    return this.#emitIfObservableChanged()
  }

  #tryResolvePendingFocusRequest(): boolean {
    const request = this.#pendingFocusRequest
    if (!request) {
      return false
    }

    const targetPath = this.#resolveRequestedLogicalPath(request.path, request.reason)
    if (!targetPath) {
      return false
    }

    this.#commitFocusPath(targetPath, request.reason)
    return true
  }

  #commitFocusPath(path: FocusPath, reason: FocusApplyReason) {
    this.#pendingFocusRequest = undefined
    this.#session = undefined
    this.#focusedPath = path
    this.#highlightedPath = path
    this.#rememberFocusPath(path)
    this.#revealPath(path, false)
    this.#applyPhysicalFocus(path, reason)
  }

  #applyPhysicalFocus(targetPath: FocusPath, reason: FocusApplyReason) {
    for (let length = targetPath.length; length >= 1; length -= 1) {
      const ownerPath = targetPath.slice(0, length)
      const owner = this.#getFocusable(ownerPath)
      if (!owner?.input.applyFocus) {
        continue
      }

      owner.input.applyFocus({
        selfPath: owner.path,
        targetPath,
        reason,
      })
      return
    }
  }

  #rememberFocusPath(path: FocusPath) {
    let changed = false
    for (const ancestorPath of focusPathAncestors(path)) {
      const key = requirePathKey(ancestorPath)
      const previous = this.#rememberedDescendantByPathKey.get(key)
      if (!sameFocusPath(previous, path)) {
        this.#rememberedDescendantByPathKey.set(key, path)
        changed = true
      }
    }
    if (changed) {
      this.#rememberedRevision += 1
    }
  }

  #resolveRequestedLogicalPath(
    requestPath: FocusPath,
    reason: FocusApplyReason,
  ): FocusPath | undefined {
    const focusable = this.#getFocusable(requestPath)
    if (!focusable) {
      return undefined
    }

    if (focusable.input.focusable && !focusable.input.disabled && reason === "escape") {
      return requestPath
    }

    if (focusable.input.delegatesFocus) {
      return (
        this.#getCurrentFocusableDescendantPathWithin(requestPath) ??
        this.#getRememberedFocusableDescendantPathWithin(requestPath) ??
        this.#firstFocusableDescendant(requestPath)
      )
    }

    if (focusable.input.focusable && !focusable.input.disabled) {
      return requestPath
    }

    return (
      this.#getCurrentFocusableDescendantPathWithin(requestPath) ??
      this.#getRememberedFocusableDescendantPathWithin(requestPath) ??
      this.#firstFocusableDescendant(requestPath)
    )
  }

  #getCurrentFocusableDescendantPathWithin(path: FocusPath): FocusPath | undefined {
    return this.#validateFocusableDescendantPath(path, this.#focusedPath)
  }

  #getRememberedFocusableDescendantPathWithin(path: FocusPath): FocusPath | undefined {
    const rememberedPath = this.#rememberedDescendantByPathKey.get(requirePathKey(path))
    return this.#validateFocusableDescendantPath(path, rememberedPath)
  }

  #validateFocusableDescendantPath(path: FocusPath, candidatePath: FocusPath | undefined): FocusPath | undefined {
    if (!candidatePath || sameFocusPath(path, candidatePath) || !isAncestorFocusPath(path, candidatePath)) {
      return undefined
    }

    const candidate = this.#getFocusable(candidatePath)
    if (!candidate || !candidate.input.focusable || candidate.input.disabled) {
      return undefined
    }

    return candidate.path
  }

  #firstFocusableDescendant(path: FocusPath): FocusPath | undefined {
    const descendants = [...this.#focusables.values()]
      .filter((focusable) => {
        return (
          !sameFocusPath(focusable.path, path) &&
          isAncestorFocusPath(path, focusable.path) &&
          focusable.input.focusable &&
          !focusable.input.disabled
        )
      })
      .sort((a, b) => a.order - b.order)

    return descendants[0]?.path
  }

  #computeNavigationState(): FocusNavigationState {
    const activeScopePath = this.#session?.activeScopePath ?? this.#computeScopePath()
    const scopeFocusable = this.#getFocusable(activeScopePath)
    return {
      active: this.#session !== undefined,
      focusedPath: this.#focusedPath,
      highlightedPath: this.#highlightedPath,
      activeScopePath,
      escLabel: scopeFocusable?.input.trap ? scopeFocusable.input.trapEscLabel : undefined,
    }
  }

  #resolveHighlightedPath(): FocusPath | undefined {
    const session = this.#session
    if (!session) {
      return undefined
    }

    const highlightedPath = this.#highlightedPath
    if (highlightedPath && this.#isPathNavigableInScope(highlightedPath, session.activeScopePath)) {
      return highlightedPath
    }

    const fallback =
      (this.#focusedPath
        ? this.#findNearestAncestorNavigablePath(this.#focusedPath, session.activeScopePath, true)
        : undefined) ?? this.#firstVisibleNavigableInScope(session.activeScopePath)?.path

    if (fallback) {
      this.#highlightedPath = fallback
    }

    return fallback
  }

  #chooseInitialHighlightedPath(activeScopePath: FocusPath): FocusPath | undefined {
    const focusedAnchor = this.#focusedPath
      ? this.#findNearestAncestorNavigablePath(this.#focusedPath, activeScopePath, true)
      : undefined
    if (focusedAnchor) {
      return focusedAnchor
    }

    if (
      this.#highlightedPath &&
      this.#isPathNavigableInScope(this.#highlightedPath, activeScopePath)
    ) {
      return this.#highlightedPath
    }

    return this.#firstVisibleNavigableInScope(activeScopePath)?.path
  }

  #computeScopePath(): FocusPath {
    const basePath = this.#focusedPath ?? this.#highlightedPath
    if (!basePath) {
      return ROOT_FOCUS_PATH
    }

    let activeScopePath = ROOT_FOCUS_PATH
    for (const ancestor of focusPathAncestors(basePath)) {
      const focusable = this.#getFocusable(ancestor)
      if (focusable?.input.trap) {
        activeScopePath = ancestor
      }
    }
    return activeScopePath
  }

  #firstVisibleNavigableInScope(activeScopePath: FocusPath): MeasuredFocusNode | undefined {
    return this.#collectMeasuredNavigableFocusables(activeScopePath)[0]
  }

  #collectMeasuredNavigableFocusables(activeScopePath: FocusPath): MeasuredFocusNode[] {
    const nodes: MeasuredFocusNode[] = []
    for (const focusable of this.#focusables.values()) {
      if (!this.#isPathNavigableInScope(focusable.path, activeScopePath)) {
        continue
      }

      const rect = this.#resolvePathRect(focusable.path)
      if (!rect) {
        continue
      }

      nodes.push({
        path: focusable.path,
        rect,
        order: focusable.order,
      })
    }

    nodes.sort((a, b) => a.order - b.order)
    return nodes
  }

  #measureNavigablePath(path: FocusPath): MeasuredFocusNode | undefined {
    if (!this.#isPathNavigableInScope(path, this.#session?.activeScopePath ?? ROOT_FOCUS_PATH)) {
      return undefined
    }

    const focusable = this.#getFocusable(path)
    const rect = this.#resolvePathRect(path)
    if (!focusable || !rect) {
      return undefined
    }

    return {
      path,
      rect,
      order: focusable.order,
    }
  }

  #resolvePathRect(path: FocusPath): FocusRect | undefined {
    const focusable = this.#getFocusable(path)
    const baseRect = focusable?.input.getViewportRect?.()
    if (!focusable || !baseRect) {
      return undefined
    }

    let rect: FocusVisibleRect = { ...baseRect }
    for (const ancestor of focusPathAncestors(path)) {
      const ancestorFocusable = this.#getFocusable(ancestor)
      const clipRect = ancestorFocusable?.input.getViewportClipRect?.()
      if (!clipRect) {
        continue
      }
      rect = intersectRects(rect, clipRect)
      if (!rect) {
        return undefined
      }
    }

    return rect.width > 0 && rect.height > 0 ? rect : undefined
  }

  #isPathNavigableInScope(path: FocusPath, activeScopePath: FocusPath): boolean {
    const focusable = this.#getFocusable(path)
    if (!focusable || !focusable.input.focusable || !focusable.input.navigable || focusable.input.disabled) {
      return false
    }

    if (
      !sameFocusPath(activeScopePath, ROOT_FOCUS_PATH) &&
      !isAncestorFocusPath(activeScopePath, path)
    ) {
      return false
    }

    for (let length = path.length - 1; length >= 1; length -= 1) {
      const ancestorPath = path.slice(0, length)
      if (!sameFocusPath(activeScopePath, ROOT_FOCUS_PATH) && ancestorPath.length < activeScopePath.length) {
        break
      }

      const ancestor = this.#getFocusable(ancestorPath)
      if (!ancestor) {
        continue
      }
      if (!sameFocusPath(ancestor.path, path) && !ancestor.input.childrenNavigable) {
        return false
      }
    }

    return true
  }

  #findNearestAncestorFocusablePath(
    path: FocusPath,
    activeScopePath: FocusPath,
  ): FocusPath | undefined {
    for (let length = path.length - 1; length >= activeScopePath.length; length -= 1) {
      const ancestorPath = path.slice(0, length)
      if (
        !sameFocusPath(activeScopePath, ROOT_FOCUS_PATH) &&
        !isAncestorFocusPath(activeScopePath, ancestorPath)
      ) {
        continue
      }

      const ancestor = this.#getFocusable(ancestorPath)
      if (ancestor?.input.focusable && !ancestor.input.disabled) {
        return ancestor.path
      }
    }

    return undefined
  }

  #findNearestAncestorNavigablePath(
    path: FocusPath,
    activeScopePath: FocusPath,
    includeSelf: boolean,
  ): FocusPath | undefined {
    for (let length = includeSelf ? path.length : path.length - 1; length >= activeScopePath.length; length -= 1) {
      const candidatePath = path.slice(0, length)
      if (this.#isPathNavigableInScope(candidatePath, activeScopePath) && this.#resolvePathRect(candidatePath)) {
        return candidatePath
      }
    }

    return undefined
  }

  #revealPath(descendantPath: FocusPath, captureSnapshots: boolean) {
    for (let i = descendantPath.length - 1; i >= 1; i -= 1) {
      const ancestorPath = descendantPath.slice(0, i)
      const ancestor = this.#getFocusable(ancestorPath)
      if (!ancestor?.input.revealDescendant) {
        continue
      }

      if (captureSnapshots) {
        this.#captureSnapshot(ancestor.path)
      }

      ancestor.input.revealDescendant(descendantPath, DEFAULT_REVEAL_OPTIONS)
    }
  }

  #captureSnapshot(path: FocusPath) {
    const session = this.#session
    const key = focusPathKey(path)
    if (!session || !key || session.snapshots.has(key)) {
      return
    }

    const focusable = this.#getFocusable(path)
    if (!focusable?.input.captureSnapshot || !focusable.input.restoreSnapshot) {
      return
    }

    session.snapshots.set(key, {
      path,
      snapshot: focusable.input.captureSnapshot(),
    })
  }

  #repairFocusedPath() {
    const previousFocusedPath = this.#focusedPath
    if (previousFocusedPath && this.#isPathValidFocusable(previousFocusedPath)) {
      return
    }

    this.#focusedPath = previousFocusedPath
      ? this.#findNearestAncestorFocusablePath(previousFocusedPath, ROOT_FOCUS_PATH)
      : undefined

    if (!this.#session) {
      this.#highlightedPath = this.#focusedPath
    }
  }

  #repairHighlightedPath() {
    if (this.#session) {
      this.#resolveHighlightedPath()
      return
    }

    this.#highlightedPath = this.#focusedPath
  }

  #pruneInvalidRememberedDescendants() {
    for (const [ancestorKey, rememberedPath] of this.#rememberedDescendantByPathKey) {
      const ancestor = this.#focusables.get(ancestorKey)
      if (!ancestor || !this.#validateFocusableDescendantPath(ancestor.path, rememberedPath)) {
        this.#deleteRememberedDescendant(ancestorKey)
      }
    }
  }

  #descendantPathOrUndefined(path: FocusPath, candidatePath: FocusPath | undefined): FocusPath | undefined {
    if (!candidatePath || sameFocusPath(path, candidatePath) || !isAncestorFocusPath(path, candidatePath)) {
      return undefined
    }
    return candidatePath
  }

  #isPathValidFocusable(path: FocusPath): boolean {
    const focusable = this.#getFocusable(path)
    return Boolean(focusable?.input.focusable && !focusable.input.disabled)
  }

  #deleteRememberedDescendant(pathKey: string) {
    if (this.#rememberedDescendantByPathKey.delete(pathKey)) {
      this.#rememberedRevision += 1
    }
  }

  #getFocusable(path: FocusPath): FocusableRecord | undefined {
    return this.#focusables.get(requirePathKey(path))
  }

  #assertPathAvailable(path: FocusPath) {
    const key = requirePathKey(path)
    if (this.#focusables.has(key)) {
      throw new Error(`Duplicate focusable path: ${path.join(" / ")}`)
    }
  }

  #emitIfObservableChanged(): boolean {
    const nextNavigationState = this.#computeNavigationState()
    const navigationChanged = !sameNavigationState(this.#navigationState, nextNavigationState)
    const rememberedChanged = this.#lastNotifiedRememberedRevision !== this.#rememberedRevision

    if (!navigationChanged && !rememberedChanged) {
      return false
    }

    this.#navigationState = nextNavigationState
    this.#lastNotifiedRememberedRevision = this.#rememberedRevision
    for (const listener of this.#listeners) {
      listener()
    }
    return true
  }
}

function freezePath(parentPath: FocusPath, id: string): FocusPath {
  return Object.freeze([...parentPath, id])
}

function requirePathKey(path: FocusPath): string {
  const key = focusPathKey(path)
  if (!key) {
    return ""
  }
  return key
}

function suffixForAncestor(
  ancestorPath: FocusPath,
  descendantPath: FocusPath | undefined,
): FocusPathSuffix | undefined {
  if (!descendantPath || !isAncestorFocusPath(ancestorPath, descendantPath)) {
    return undefined
  }

  const suffix = descendantPath.slice(ancestorPath.length)
  return suffix.length > 0 ? Object.freeze(suffix) : undefined
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

function comparePathStrings(a: FocusPath, b: FocusPath): number {
  return a.join("\u001f").localeCompare(b.join("\u001f"))
}

function sameNavigationState(a: FocusNavigationState, b: FocusNavigationState): boolean {
  return (
    a.active === b.active &&
    a.escLabel === b.escLabel &&
    sameFocusPath(a.focusedPath, b.focusedPath) &&
    sameFocusPath(a.highlightedPath, b.highlightedPath) &&
    sameFocusPath(a.activeScopePath, b.activeScopePath)
  )
}
