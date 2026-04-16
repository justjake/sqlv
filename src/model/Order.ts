export type OrderString = string & { __orderstring__: true }

export function OrderString(string: string): OrderString {
  return string as OrderString
}
