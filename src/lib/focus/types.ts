export type FocusableId = string
export type FocusPath = readonly FocusableId[]
export type FocusPathSuffix = readonly FocusableId[]

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

export type FocusSnapshot = unknown

export type FocusApplyReason = "focus" | "activate" | "escape" | "mouse"

export type FocusApplyContext = {
  selfPath: FocusPath
  targetPath: FocusPath
  reason: FocusApplyReason
}

export type FocusableRegistration = {
  id: FocusableId
  parentPath: FocusPath
  focusable?: boolean
  navigable?: boolean
  childrenNavigable?: boolean
  delegatesFocus?: boolean
  disabled?: boolean
  trap?: boolean
  onTrapEsc?: () => void
  trapEscLabel?: string
  applyFocus?: (context: FocusApplyContext) => void
  getViewportRect?: () => FocusVisibleRect
  getViewportClipRect?: () => FocusVisibleRect
  revealDescendant?: (descendantPath: FocusPath, options: FocusRevealOptions) => void
  captureSnapshot?: () => FocusSnapshot
  restoreSnapshot?: (snapshot: FocusSnapshot) => void
}

export type NormalizedFocusableRegistration = Omit<
  FocusableRegistration,
  "focusable" | "navigable" | "childrenNavigable" | "delegatesFocus" | "disabled"
> & {
  focusable: boolean
  navigable: boolean
  childrenNavigable: boolean
  delegatesFocus: boolean
  disabled: boolean
}

export type FocusNavigationState = {
  active: boolean
  focusedPath?: FocusPath
  highlightedPath?: FocusPath
  activeScopePath: FocusPath
  escLabel?: string
}

export type FocusTreeSnapshot = FocusNavigationState & {
  focusables: Array<{
    path: FocusPath
    parentPath: FocusPath
    focusable: boolean
    navigable: boolean
    childrenNavigable: boolean
    delegatesFocus: boolean
    disabled: boolean
    trap: boolean
    hasViewportRect: boolean
    hasViewportClipRect: boolean
    hasRevealDescendant: boolean
    hasApplyFocus: boolean
    hasOnTrapEsc: boolean
    order: number
  }>
  rememberedDescendantPaths: Array<{
    ancestorPath: FocusPath
    rememberedPath: FocusPath
  }>
  pendingFocusPath?: FocusPath
  capturedSnapshotPaths: FocusPath[]
}

export function normalizeFocusableRegistration(
  input: FocusableRegistration,
): NormalizedFocusableRegistration {
  const focusable = input.focusable ?? false
  return {
    ...input,
    focusable,
    navigable: input.navigable ?? focusable,
    childrenNavigable: input.childrenNavigable ?? true,
    delegatesFocus: input.delegatesFocus ?? false,
    disabled: input.disabled ?? false,
  }
}

export type FocusNavigableId = FocusableId
export type FocusNavigablePath = FocusPath
export type FocusNavigationParticipant = Pick<
  FocusableRegistration,
  "captureSnapshot" | "restoreSnapshot"
>
export type FocusNavigationSnapshot = FocusSnapshot
export type FocusAreaRegistration = FocusableRegistration
export type FocusNodeRegistration = FocusableRegistration
