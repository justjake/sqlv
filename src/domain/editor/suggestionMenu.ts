export function selectVisibleSuggestionItems<T extends { id: string }>(
  items: readonly T[],
  focusedItemId: string | undefined,
  maxVisibleItems: number,
): T[] {
  if (items.length <= maxVisibleItems) {
    return [...items]
  }

  const focusedIndex = items.findIndex((item) => item.id === focusedItemId)
  const targetIndex = focusedIndex >= 0 ? focusedIndex : 0
  const start = clampValue(targetIndex - Math.floor(maxVisibleItems / 2), 0, items.length - maxVisibleItems)
  return items.slice(start, start + maxVisibleItems)
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
