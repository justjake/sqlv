import { QueryClientProvider } from "@tanstack/react-query"
import { createContext, useContext, type ReactNode } from "react"
import type { Environment } from "../lib/types/Environment"

const EnvContext = createContext<Environment | undefined>(undefined)
EnvContext.displayName = "EnvContext"

export function useEnv(): Environment {
  const env = useContext(EnvContext)
  if (!env) {
    throw new Error(`EnvContext not provided`)
  }
  return env
}

export function EnvProvider(props: { children: ReactNode; value: Environment }) {
  return (
    <EnvContext.Provider value={props.value}>
      <QueryClientProvider client={props.value.queryClient}>{props.children}</QueryClientProvider>
    </EnvContext.Provider>
  )
}
