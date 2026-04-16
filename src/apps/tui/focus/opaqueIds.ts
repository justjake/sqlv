import { useRef } from "react"

export function useOpaqueIdMap<Key extends string | number>(
  keys: readonly Key[],
  prefix: string,
): ReadonlyMap<Key, string> {
  const assignedIdsRef = useRef(new Map<Key, string>())
  const nextIdRef = useRef(0)
  const currentIds = new Map<Key, string>()

  for (const key of keys) {
    let id = assignedIdsRef.current.get(key)
    if (!id) {
      id = `${prefix}-${nextIdRef.current++}`
      assignedIdsRef.current.set(key, id)
    }
    currentIds.set(key, id)
  }

  return currentIds
}
