export function preserveErrorStack<T extends Error>(target: T, source: unknown): T {
  if (source instanceof Error && typeof source.stack === "string") {
    target.stack = source.stack
  }
  return target
}
