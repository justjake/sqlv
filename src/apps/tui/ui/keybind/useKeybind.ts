import { useContext } from "react"
import { KeybindContext, type KeybindContextValue } from "./KeybindContext"

export function useKeybind(): KeybindContextValue {
  const context = useContext(KeybindContext)
  if (!context) {
    throw new Error("useKeybind requires a <KeybindProvider>")
  }
  return context
}
