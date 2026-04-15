import type { FocusPath, FocusPathSuffix } from "./types"

export const ROOT_FOCUS_PATH: FocusPath = Object.freeze([])

export function focusPath(parentPath: FocusPath, id: string): FocusPath {
  return Object.freeze([...parentPath, id])
}

export function focusPathKey(path: FocusPath | undefined): string | undefined {
  if (!path) {
    return undefined
  }
  return path.join("\u001f")
}

export function sameFocusPath(a: FocusPath | undefined, b: FocusPath | undefined): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b || a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

export function isAncestorFocusPath(
  ancestor: FocusPath | undefined,
  descendant: FocusPath | undefined,
): boolean {
  if (!ancestor || !descendant || ancestor.length > descendant.length) {
    return false
  }
  for (let i = 0; i < ancestor.length; i += 1) {
    if (ancestor[i] !== descendant[i]) {
      return false
    }
  }
  return true
}

export function focusPathAncestors(path: FocusPath): FocusPath[] {
  const ancestors: FocusPath[] = []
  for (let i = 1; i <= path.length; i += 1) {
    ancestors.push(Object.freeze(path.slice(0, i)))
  }
  return ancestors
}

export function focusPathSubpath(
  ancestorPath: FocusPath,
  descendantPath: FocusPath | undefined,
): FocusPathSuffix | undefined {
  if (!descendantPath || !isAncestorFocusPath(ancestorPath, descendantPath)) {
    return undefined
  }

  const suffix = descendantPath.slice(ancestorPath.length)
  return suffix.length > 0 ? Object.freeze(suffix) : undefined
}
