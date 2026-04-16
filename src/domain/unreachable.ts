export function unreachable(value: never, err?: (value: never) => Error): never {
  if (err) {
    throw err(value)
  }
  throw new Error(`Expected case to never occur: ${debugStringify(value)}`)
}

function debugStringify(value: unknown): string {
  try {
    switch (typeof value) {
      case "boolean":
      case "string":
      case "number":
        return JSON.stringify(value)
      case "undefined":
      case "symbol":
      case "function":
        return String(value)
      case "bigint":
        return `${value}n`
      case "object":
        if (value === null) {
          return "null"
        }
        const nullPrototype = !Object.getPrototypeOf(value)
        const className =
          "constructor" in value
            ? (value.constructor.name ?? "[anonymous constructor]")
            : nullPrototype
              ? "[null prototype]"
              : "[???]"
        const ownToString = "toString" in value && value.toString !== {}.toString
        return [className, ownToString ? String(value) : undefined, JSON.stringify(value)].filter(Boolean).join(" ")
      default:
        throw new Error(`unknown typeof case: typeof ${String(value)} -> ${typeof value}`)
    }
  } catch (err) {
    return `[error stringifying: ${err}]`
  }
}

export function mustBeDefined<T>(value: T | undefined, err?: (value: T | undefined) => Error): T {
  if (value === undefined) {
    if (err) {
      throw err(value)
    }
    throw new Error(`Expected value to be defined: ${debugStringify(value)}`)
  }
  return value
}

export function mustBeSingle<T>(value: T | T[] | undefined): T {
  if (value === undefined) {
    throw new Error(`Expected value to be defined: ${debugStringify(value)}`)
  }

  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new Error(`Expected value to be a single item: ${debugStringify(value)}`)
    }
    return value[0]!
  }

  return value
}

export function mustBeOptionalSingle<T>(value: T | T[] | undefined): T | undefined {
  if (value === undefined) {
    return undefined
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined
    }
    if (value.length !== 1) {
      throw new Error(`Expected value to be zero or one item: ${debugStringify(value)}`)
    }
    return value[0]!
  }

  return value
}

export function mustBeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    throw new Error(`Expected value to be defined: ${debugStringify(value)}`)
  }
  if (Array.isArray(value)) {
    return value
  }
  return [value]
}
