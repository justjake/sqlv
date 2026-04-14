export type FocusNavigableId = string
export type FocusNavigablePath = readonly FocusNavigableId[]

export type FocusDirection = "up" | "down" | "left" | "right"

export type FocusRect = {
  x: number
  y: number
  width: number
  height: number
}

export type FocusVisibleRect = FocusRect | null

export type FocusRevealOptions = {
  axis: "x" | "y" | "both"
  align: "nearest"
}

export type FocusNavigationSnapshot = unknown

export type FocusNavigationParticipant = {
  captureFocusNavigationSnapshot?: () => FocusNavigationSnapshot
  restoreFocusNavigationSnapshot?: (snapshot: FocusNavigationSnapshot) => void
}

export type FocusAreaRegistration = FocusNavigationParticipant & {
  id: FocusNavigableId
  parentPath: FocusNavigablePath
  trap?: boolean
  onEsc?: () => void
  onEscLabel?: string
  getViewportRect?: () => FocusVisibleRect
  getViewportClipRect?: () => FocusVisibleRect
  revealDescendant?: (descendantPath: FocusNavigablePath, options: FocusRevealOptions) => void
}

export type FocusNodeRegistration = FocusNavigationParticipant & {
  id: FocusNavigableId
  parentPath: FocusNavigablePath
  focus: () => void
  getViewportRect: () => FocusVisibleRect
  disabled?: boolean
}

export type FocusNavigationState = {
  active: boolean
  focusedPath?: FocusNavigablePath
  highlightedPath?: FocusNavigablePath
  activeScopePath: FocusNavigablePath
  escLabel?: string
}

export type FocusTreeSnapshot = FocusNavigationState & {
  areas: Array<{
    path: FocusNavigablePath
    parentPath: FocusNavigablePath
    trap: boolean
    hasViewportRect: boolean
    hasViewportClipRect: boolean
    hasRevealDescendant: boolean
    hasOnEsc: boolean
    order: number
  }>
  nodes: Array<{
    path: FocusNavigablePath
    parentPath: FocusNavigablePath
    disabled: boolean
    order: number
  }>
  capturedSnapshotPaths: FocusNavigablePath[]
}
