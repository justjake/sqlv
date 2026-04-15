import type { KeyEvent, MouseEvent } from "@opentui/core"
import { flushSync } from "@opentui/react"
import { useState, type ReactNode } from "react"
import { labelizeSequence, useShortcut } from "./ui/keybind"
import type { ShortcutKeys } from "./ui/shortcutKeys"
import { Text } from "./ui/Text"
import { useTheme } from "./ui/theme"

export type ShortcutProps = {
  keys: string
  label: ReactNode
  onKey?: (key: KeyEvent | MouseEvent) => void
  enabled?: boolean
}

export function Shortcut<TKey extends string>(props: Omit<ShortcutProps, "keys"> & { keys: ShortcutKeys<TKey> }): ReactNode
export function Shortcut(props: ShortcutProps): ReactNode
export function Shortcut(props: ShortcutProps) {
  const { keys, label, onKey, enabled } = props
  const [active, setActive] = useState(false)
  const theme = useTheme()

  const { sequence } = useShortcut({
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
        {labelizeSequence(sequence)} {label}
      </Text>
    </box>
  )
}
