import { createBunSqlVisor, type CreateBunSqlVisorOptions } from "../platforms/bun/createBunSqlVisor"

export async function init(options?: CreateBunSqlVisorOptions) {
  return createBunSqlVisor(options)
}

export type { CreateBunSqlVisorOptions }
