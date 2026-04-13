class Defer {
  constructor(public readonly fn: () => void) {}
  [Symbol.dispose]() {
    return this.fn()
  }
}

class AsyncDefer {
  constructor(public readonly fn: () => Promise<void>) {}
  async [Symbol.asyncDispose]() {
    return await this.fn()
  }
}

export function aborter(signal: AbortSignal | undefined, fn: () => void): Defer {
  if (signal) {
    signal.addEventListener("abort", fn)
  }
  return defer(() => {
    if (signal) {
      signal.removeEventListener("abort", fn)
    }
  })
}

export function cleanup<T>(create: () => T, destroy: (value: T) => void): Defer {
  const value = create()
  return defer(() => destroy(value))
}

export function defer(fn: () => void): Defer {
  return new Defer(fn)
}

export function asyncDefer(fn: () => Promise<void>): AsyncDefer {
  return new AsyncDefer(fn)
}
