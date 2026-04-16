import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"

import { Focusable } from "../focus/Focusable"

import { DEFAULT_MODAL_Z_INDEX, resolveModalViewportBounds } from "./modalShared"
import { Text } from "./Text"
import { useTheme } from "./theme"

const PROMPT_MODAL_FOOTER_HEIGHT = 3

export type PromptModalProps = {
  children: ReactNode
  footer?: ReactNode
  focusableId: string
  onClose?: () => void
  title?: ReactNode
  trapEscLabel?: string
  zIndex?: number
}

export function PromptModal(props: PromptModalProps) {
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()
  const theme = useTheme()
  const { horizontalMargin, maxPanelHeight, maxPanelWidth, verticalMargin } = resolveModalViewportBounds(
    terminalWidth,
    terminalHeight,
  )
  const maxBodyWidth = Math.max(1, maxPanelWidth - 4)

  return (
    <Focusable
      autoFocus
      alignItems="center"
      backgroundColor={theme.modalBackdropBg}
      flexDirection="column"
      focusable={false}
      focusableId={props.focusableId}
      height={terminalHeight}
      hideNavigationHalo
      justifyContent="center"
      left={0}
      navigable={false}
      onMouseUp={() => props.onClose?.()}
      onTrapEsc={props.onClose}
      paddingBottom={verticalMargin}
      paddingLeft={horizontalMargin}
      paddingRight={horizontalMargin}
      paddingTop={verticalMargin}
      position="absolute"
      top={0}
      trap
      trapEscLabel={props.trapEscLabel}
      width={terminalWidth}
      zIndex={props.zIndex ?? DEFAULT_MODAL_Z_INDEX}
    >
      <Focusable
        delegatesFocus
        focusSelf
        focusable
        focusableId="panel"
        hideNavigationHalo
        maxHeight={maxPanelHeight}
        maxWidth={maxPanelWidth}
      >
        <box
          backgroundColor={theme.backgroundBg}
          flexDirection="column"
          onMouseDown={(event) => {
            event.stopPropagation()
          }}
          onMouseUp={(event) => {
            event.stopPropagation()
          }}
        >
          {props.title ? (
            <box
              alignSelf="stretch"
              justifyContent="center"
              maxWidth={maxBodyWidth}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
            >
              {renderPromptTextLikeNode(props.title)}
            </box>
          ) : null}
          <box
            alignSelf="stretch"
            flexDirection="column"
            justifyContent="center"
            minHeight={5}
            maxWidth={maxBodyWidth}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={props.title ? 0 : 1}
          >
            {renderPromptTextLikeNode(props.children)}
          </box>
          {props.footer ? (
            <box alignItems="stretch" alignSelf="stretch" flexDirection="row" height={PROMPT_MODAL_FOOTER_HEIGHT}>
              {props.footer}
            </box>
          ) : null}
        </box>
      </Focusable>
    </Focusable>
  )
}

function renderPromptTextLikeNode(node: ReactNode) {
  if (typeof node === "string" || typeof node === "number") {
    return <Text wrapMode="word">{node}</Text>
  }

  return node
}
