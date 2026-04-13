export type MatchBranches<T, E, U> = {
  ok: (value: T) => U
  err: (error: E) => U
}

export abstract class AnyResult<T, E> {
  ok(): this is Ok<T> {
    return this instanceof Ok
  }

  err(): this is Err<E> {
    return this instanceof Err
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    if (this.ok()) {
      return Result.ok(fn(this.value))
    }

    if (this.err()) {
      return this
    }

    return invalidResult()
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    if (this.err()) {
      return Result.err(fn(this.error))
    }

    if (this.ok()) {
      return this
    }

    return invalidResult()
  }

  andThen<U, F = never>(fn: (value: T) => Result<U, F>): Result<U, E | F> {
    if (this.ok()) {
      return fn(this.value)
    }

    if (this.err()) {
      return this
    }

    return invalidResult()
  }

  or(value: T): Result<T, E> {
    if (this.ok()) {
      return this
    }

    if (this.err()) {
      return Result.ok(value)
    }

    return invalidResult()
  }

  orElse<F>(fn: (error: E) => Result<T, F>): Result<T, F> {
    if (this.err()) {
      return fn(this.error)
    }

    if (this.ok()) {
      return this
    }

    return invalidResult()
  }

  match<U>(branches: MatchBranches<T, E, U>): U {
    if (this.ok()) {
      return branches.ok(this.value)
    }

    if (this.err()) {
      return branches.err(this.error)
    }

    return invalidResult()
  }

  tap(fn: (value: T) => void): this {
    if (this.ok()) {
      fn(this.value)
    }

    return this
  }

  tapErr(fn: (error: E) => void): this {
    if (this.err()) {
      fn(this.error)
    }

    return this
  }

  expect(message: string): T {
    if (this.ok()) {
      return this.value
    }

    if (this.err()) {
      throw new UnwrapError(message, this.error)
    }

    return invalidResult()
  }

  expectErr(message: string): E {
    if (this.err()) {
      return this.error
    }

    if (this.ok()) {
      throw new UnwrapError(message, this.value)
    }

    return invalidResult()
  }

  unwrapOr(value: T): T {
    if (this.ok()) {
      return this.value
    }

    return value
  }

  unwrapOrElse(fn: (error: E) => T): T {
    if (this.ok()) {
      return this.value
    }

    if (this.err()) {
      return fn(this.error)
    }

    return invalidResult()
  }

  abstract unwrap(): T
  abstract unwrapErr(): E
}

export class Ok<T> extends AnyResult<T, never> {
  constructor(public readonly value: T) {
    super()
  }

  override toString(): string {
    return `Ok(${String(this.value)})`
  }

  override unwrap(): T {
    return this.value
  }

  override unwrapErr(): never {
    throw new UnwrapError("Tried to unwrapErr an Ok result", this.value)
  }
}

export class UnwrapError<T> extends Error {
  declare cause: T

  constructor(message: string, cause: T) {
    super(message, { cause })
    this.name = "UnwrapError"
  }
}

export class Err<E> extends AnyResult<never, E> {
  constructor(public readonly error: E) {
    super()
  }

  override toString(): string {
    return `Err(${String(this.error)})`
  }

  override unwrap(): never {
    throw new UnwrapError("Tried to unwrap an Err result", this.error)
  }

  override unwrapErr(): E {
    return this.error
  }
}

export type Result<T, E> = Ok<T> | Err<E>

function invalidResult(): never {
  throw new TypeError("Invalid Result variant")
}

function resultOk<T>(value: T): Ok<T> {
  return new Ok(value)
}

function resultErr<E>(error: E): Err<E> {
  return new Err(error)
}

function isResult(value: unknown): value is Result<unknown, unknown> {
  return value instanceof Ok || value instanceof Err
}

function defaultMapError<E>(thrown: E): Error {
  if (thrown && thrown instanceof Error) {
    return thrown
  }

  return new UnknownError(`Non-error throw: ${thrown}`, {
    cause: thrown,
  })
}

class UnknownError extends Error {}

function fromThrowable<T>(fn: () => T): Result<T, Error>
function fromThrowable<T>(fn: () => Promise<T>): Promise<Result<T, Error>>
function fromThrowable<T, E>(fn: () => T, mapError: (error: unknown) => E): Result<T, E>
function fromThrowable<T, E>(fn: () => Promise<T>, mapError: (error: unknown) => E): Promise<Result<T, E>>
function fromThrowable<T, E>(
  fn: () => T | Promise<T>,
  mapError?: (error: unknown) => E,
): Result<T, E | unknown> | Promise<Result<T, E | unknown>> {
  const parseError = mapError ?? defaultMapError
  try {
    const valueOrPromise = fn()
    if (valueOrPromise && typeof valueOrPromise === "object" && "then" in valueOrPromise) {
      return (valueOrPromise as Promise<T>).then(resultOk, (err) => resultErr(parseError(err) as E))
    } else {
      return resultOk(valueOrPromise)
    }
  } catch (error) {
    return resultErr(parseError(error))
  }
}

function allResults<T, E>(results: Iterable<Result<T, E>>): Result<T[], E> {
  const values: T[] = []

  for (const result of results) {
    if (result.err()) {
      return result
    }

    values.push(result.value)
  }

  return resultOk(values)
}

export const Result = {
  toError: defaultMapError,
  ok: resultOk,
  err: resultErr,
  isResult,
  try: fromThrowable,
  all: allResults,
}
