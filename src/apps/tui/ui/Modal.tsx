import { useTerminalDimensions } from "@opentui/react"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useShortcut } from "./keybind/useShortcut"
import { DEFAULT_MODAL_Z_INDEX, resolveModalViewportBounds } from "./modalShared"
import { useIsFocusNavigationActive } from "../focus/context"
import { Text } from "./Text"
import { useTheme } from "./theme"

const ModalBottomRightContext = createContext<((node: ReactNode | undefined) => void) | null>(null)

export type ModalProps = {
  children: ReactNode
  bottomRight?: ReactNode
  focusNavigable?: boolean
  onClose?: () => void
  width?: number
  height?: number
  size?: "medium" | "large"
  title?: ReactNode
  zIndex?: number
}

export function useModalBottomRight(node: ReactNode | undefined) {
  const setBottomRight = useContext(ModalBottomRightContext)

  useEffect(() => {
    if (!setBottomRight) {
      return
    }

    setBottomRight(node)
    return () => {
      setBottomRight(undefined)
    }
  }, [node, setBottomRight])
}

export function Modal(props: ModalProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()
  const theme = useTheme()
  const [slottedBottomRight, setSlottedBottomRight] = useState<ReactNode>()
  const { horizontalMargin, maxPanelHeight, maxPanelWidth, verticalMargin } = resolveModalViewportBounds(
    terminalWidth,
    terminalHeight,
  )
  const panelWidth = props.width ?? (props.size === "large" ? 80 : 60)
  const resolvedWidth = Math.max(1, Math.min(panelWidth, maxPanelWidth))
  const resolvedHeight = props.height === undefined ? undefined : Math.max(1, Math.min(props.height, maxPanelHeight))
  const bottomRight = slottedBottomRight ?? props.bottomRight
  const showChrome = props.title !== undefined || props.onClose !== undefined
  const focusNavigable = props.focusNavigable ?? false

  useShortcut({
    enabled: !!props.onClose && !focusNavigable,
    global: true,
    keys: "esc",
    onKey(event) {
      event.preventDefault()
      event.stopPropagation()
      props.onClose?.()
    },
  })

  return (
    <box
      alignItems="center"
      backgroundColor={theme.modalBackdropBg}
      flexDirection="column"
      height={terminalHeight}
      justifyContent="center"
      left={0}
      onMouseUp={() => props.onClose?.()}
      paddingBottom={verticalMargin}
      paddingLeft={horizontalMargin}
      paddingRight={horizontalMargin}
      paddingTop={verticalMargin}
      position="absolute"
      top={0}
      width={terminalWidth}
      zIndex={props.zIndex ?? DEFAULT_MODAL_Z_INDEX}
    >
      <ModalBottomRightContext value={setSlottedBottomRight}>
        <box
          backgroundColor={theme.backgroundBg}
          flexDirection="column"
          height={resolvedHeight}
          onMouseDown={(event) => {
            event.stopPropagation()
          }}
          onMouseUp={(event) => {
            event.stopPropagation()
          }}
          position="relative"
          width={resolvedWidth}
        >
          <box flexDirection="column" flexGrow={1} minHeight={0}>
            {showChrome ? (
              <box paddingBottom={1} paddingLeft={2} paddingRight={2} paddingTop={1}>
                <ModalHeader focusNavigable={focusNavigable} onClose={props.onClose} title={props.title} />
              </box>
            ) : null}
            <box flexGrow={1} minHeight={0} paddingTop={showChrome ? 0 : 1}>
              {props.children}
            </box>
          </box>
          {bottomRight && (
            <box bottom={0} position="absolute" right={0} zIndex={1}>
              {bottomRight}
            </box>
          )}
        </box>
      </ModalBottomRightContext>
    </box>
  )
}

function ModalHeader(props: { focusNavigable: boolean; onClose?: () => void; title?: ReactNode }) {
  const navigationActive = useIsFocusNavigationActive()
  const theme = useTheme()

  return (
    <box flexDirection="row" justifyContent="space-between">
      <Text>{props.title}</Text>
      {props.onClose ? (
        props.focusNavigable ? (
          <box flexDirection="row" gap={1} onMouseUp={props.onClose}>
            <Text fg={navigationActive ? theme.mutedFg : undefined}>esc</Text>
            <Text fg={navigationActive ? undefined : theme.mutedFg}>esc</Text>
          </box>
        ) : (
          <box onMouseUp={props.onClose}>
            <Text>esc</Text>
          </box>
        )
      ) : null}
    </box>
  )
}
