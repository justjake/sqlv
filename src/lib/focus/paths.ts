import type { FocusNavigablePath } from "./types"

export const ROOT_FOCUS_PATH: FocusNavigablePath = Object.freeze([])

export function focusPath(parentPath: FocusNavigablePath, id: string): FocusNavigablePath {
  return Object.freeze([...parentPath, id])
}

export function focusPathKey(path: FocusNavigablePath | undefined): string | undefined {
  if (!path) {
    return undefined
  }
  return path.join("\u001f")
}

export function sameFocusPath(a: FocusNavigablePath | undefined, b: FocusNavigablePath | undefined): boolean {
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
  ancestor: FocusNavigablePath | undefined,
  descendant: FocusNavigablePath | undefined,
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

export function focusPathAncestors(path: FocusNavigablePath): FocusNavigablePath[] {
  const ancestors: FocusNavigablePath[] = []
  for (let i = 1; i <= path.length; i += 1) {
    ancestors.push(Object.freeze(path.slice(0, i)))
  }
  return ancestors
}
