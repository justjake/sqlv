import * as os from "node:os"
import * as path from "node:path"

export const DEFAULT_SQLVISOR_APP = "sqlv"

export function defaultDataHome(): string {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
}

export function defaultStoragePath(app = DEFAULT_SQLVISOR_APP): string {
  return path.join(defaultDataHome(), DEFAULT_SQLVISOR_APP, `${app}.db`)
}
