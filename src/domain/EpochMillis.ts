/**
 * Milliseconds since the Unix epoch, like `Date.now()`.
 */
export type EpochMillis = number & { __epochMillis__: true }

/** Cast `number` to `EpochMillis`. */
export function EpochMillis(number: number): EpochMillis {
  return number as EpochMillis
}

/** Get the current time as EpochMillis. */
EpochMillis.now = () => EpochMillis(Date.now())
