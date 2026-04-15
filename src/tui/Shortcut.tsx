import type { KeyEvent, MouseEvent } from "@opentui/core"
import { flushSync } from "@opentui/react"
import { useState, type ReactNode } from "react"
import { labelizeShortcutInput, useShortcut, type ShortcutKeyInput } from "./ui/keybind"
import { Text } from "./ui/Text"
import { useTheme } from "./ui/theme"

export type ShortcutProps = {
  keys: ShortcutKeyInput
  label: ReactNode
  onKey?: (key: KeyEvent | MouseEvent) => void
  enabled?: boolean
  global?: boolean
}

export function Shortcut(props: ShortcutProps) {
  const { enabled, global, keys, label, onKey } = props
  const [active, setActive] = useState(false)
  const theme = useTheme()

  useShortcut({
    enabled,
    global,
    keys,
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      flushSync(() => {
        setActive(true)
        onKey?.(event)
      })
      setTimeout(() => setActive(false), 300)
    },
  })

  return (
    <box
      backgroundColor={active ? theme.shortcutActiveBg : theme.shortcutBg}
      flexShrink={0}
      onMouseDown={() => {
        if (enabled) {
          setActive(true)
        }
      }}
      onMouseUp={(ev) => {
        setActive(false)
        if (!enabled) {
          return
        }
        onKey?.(ev)
      }}
      paddingLeft={1}
      paddingRight={1}
      opacity={enabled ? 1 : 0.5}
    >
      <Text>
        {labelizeShortcutInput(keys)} {label}
      </Text>
    </box>
  )
}
