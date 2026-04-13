import type { QueryClient } from "@tanstack/react-query"
import type { Persist } from "../Persist"
import type { SessionLogEntry } from "./Log"

export type Environment = {
  queryClient: QueryClient
  session: SessionLogEntry
  persist: Persist
}
