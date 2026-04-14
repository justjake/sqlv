import type { KeyEvent, MouseEvent } from "@opentui/core"
import { flushSync, useKeyboard } from "@opentui/react"
import { useState, type ReactNode } from "react"

type ShortcutUniqueProps = {
  label: ReactNode
  onKey?: (key: KeyEvent | MouseEvent) => void
  detect?: (key: KeyEvent) => boolean
  enabled?: boolean
}

type ShortcutMatchProps = Pick<KeyEvent, "name" | "ctrl" | "shift" | "meta" | "option" | "eventType">

const EVENT_KEYS: Array<keyof ShortcutMatchProps> = ["name", "ctrl", "shift", "meta", "option", "eventType"]

export type ShortcutProps = ShortcutUniqueProps & Partial<ShortcutMatchProps>

export function Shortcut(props: ShortcutProps) {
  const { label, onKey, enabled } = props
  const [active, setActive] = useState(false)

  useKeyboard((event) => {
    if (!enabled) {
      return
    }
    if (isMatchingEvent(event, props)) {
      event.preventDefault()
      event.stopPropagation()
      flushSync(() => {
        setActive(true)
        onKey?.(event)
      })
      setTimeout(() => setActive(false), 300)
    }
  })

  return (
    <box
      backgroundColor={active ? "blue" : "gray"}
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
      <text>
        {labelize(props)} {label}
      </text>
    </box>
  )
}

function labelize(props: ShortcutProps) {
  let result = ""
  if (props.ctrl) {
    result += "^"
  }
  if (props.shift) {
    result += "⬆"
  }
  if (props.meta) {
    result += "alt"
  }
  if (props.option) {
    result += "⌥"
  }
  if (props.name) {
    result += props.name
  }
  return result
}

function isMatchingEvent(event: KeyEvent, props: ShortcutProps) {
  for (const key of EVENT_KEYS) {
    const requestedValue = props[key]
    if (requestedValue !== undefined && requestedValue !== event[key]) {
      return false
    }
  }

  if (props.detect) {
    return props.detect(event)
  }

  return true
}
