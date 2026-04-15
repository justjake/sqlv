import type { KeyEvent, MouseEvent } from "@opentui/core"
import { flushSync } from "@opentui/react"
import { useState, type ReactNode } from "react"
import { labelizeSequences, useShortcut } from "./ui/keybind"
import { Text } from "./ui/Text"
import { useTheme } from "./ui/theme"

export type ShortcutProps = {
  keys: string | readonly string[]
  label: ReactNode
  onKey?: (key: KeyEvent | MouseEvent) => void
  enabled?: boolean
}

export function Shortcut(props: ShortcutProps) {
  const { keys, label, onKey, enabled } = props
  const [active, setActive] = useState(false)
  const theme = useTheme()

  const { sequences } = useShortcut({
    keys,
    enabled,
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
        {labelizeSequences(sequences)} {label}
      </Text>
    </box>
  )
}
