import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react"
import { type SqlVisor, type SqlVisorState } from "../lib/SqlVisor"

const SqlVisorContext = createContext<SqlVisor | undefined>(undefined)
SqlVisorContext.displayName = "SqlVisorContext"

export function useSqlVisor(): SqlVisor {
  const engine = useContext(SqlVisorContext)
  if (!engine) {
    throw new Error(`SqlVisorContext not provided`)
  }
  return engine
}

export function useSqlVisorState(): SqlVisorState {
  const engine = useSqlVisor()
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getState(),
    () => engine.getState(),
  )
}

export function SqlVisorProvider(props: { children: ReactNode; engine: SqlVisor }) {
  return <SqlVisorContext.Provider value={props.engine}>{props.children}</SqlVisorContext.Provider>
}
