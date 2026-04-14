import { SqlVisor, type SqlVisorCreateOptions } from "./SqlVisor"

export async function init(options?: SqlVisorCreateOptions) {
  return SqlVisor.create(options)
}
