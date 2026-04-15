import { useCallback, useMemo, useState } from "react"
import { FormLabel, RadioSelectRowInput, type RadioSelectRowOption } from "../form"
import { Focusable, useIsFocusNavigationActive, useIsFocused, useIsHighlighted } from "../focus"
import { IconProvider, resolveIconStyle, useIconGlyph, type IconName, type IconStyle } from "../ui/icons"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"

export const SETTINGS_PANE_FOCUS_ID = "settings-pane"
const ICON_STYLE_HINT = "← ⟶ cycle"

export function SettingsPane() {
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const iconStyle = resolveIconStyle(state.settings.appearance.useNerdFont)

  const setIconStyle = useCallback(
    (nextStyle: IconStyle) => {
      if (saving || nextStyle === iconStyle) {
        return
      }

      setSaving(true)
      setError(undefined)
      void engine
        .updateSettings("appearance", { useNerdFont: nextStyle === "nerdfont" })
        .catch((_error) => {
          const nextError = _error instanceof Error ? _error : new Error(String(_error))
          setError(nextError.message)
        })
        .finally(() => {
          setSaving(false)
        })
    },
    [engine, iconStyle, saving],
  )

  const iconStyleOptions = useMemo<readonly RadioSelectRowOption<IconStyle>[]>(
    () => [
      {
        key: "nerdfont",
        label: (
          <IconProvider style="nerdfont">
            <IconStyleOptionLabel title="NerdFont" />
          </IconProvider>
        ),
        value: "nerdfont",
      },
      {
        key: "unicode",
        label: (
          <IconProvider style="unicode">
            <IconStyleOptionLabel title="Unicode" />
          </IconProvider>
        ),
        value: "unicode",
      },
    ],
    [],
  )

  return (
    <Focusable
      autoFocus
      childrenNavigable={false}
      focusSelf
      focusable
      focusableId={SETTINGS_PANE_FOCUS_ID}
      height="100%"
      navigable={false}
      width="100%"
    >
      <SettingsPaneBody
        error={error}
        iconStyle={iconStyle}
        iconStyleOptions={iconStyleOptions}
        onSetIconStyle={setIconStyle}
        saving={saving}
      />
    </Focusable>
  )
}

function SettingsPaneBody(props: {
  error: string | undefined
  iconStyle: IconStyle
  iconStyleOptions: readonly RadioSelectRowOption<IconStyle>[]
  onSetIconStyle: (value: IconStyle) => void
  saving: boolean
}) {
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const theme = useTheme()
  const active = navigationActive ? highlighted : focused

  return (
    <box flexDirection="column" gap={1} height="100%" paddingBottom={1} paddingLeft={2} paddingRight={2} width="100%">
      <Text fg={theme.mutedFg}>Appearance</Text>
      <FormLabel
        active={active}
        inputFocused={!navigationActive && focused}
        name="Icon style"
      >
        <RadioSelectRowInput
          disabled={props.saving}
          hint={ICON_STYLE_HINT}
          onChange={props.onSetIconStyle}
          options={props.iconStyleOptions}
          value={props.iconStyle}
        />
      </FormLabel>
      {props.saving ? <Text fg={theme.mutedFg}>Saving...</Text> : null}
      {props.error ? <Text fg={theme.errorFg}>{props.error}</Text> : null}
    </box>
  )
}

function IconStyleOptionLabel(props: { title: string }) {
  return (
    <box flexDirection="column" gap={1} minWidth={0}>
      <Text wrapMode="none">{props.title}</Text>
      <IconPreviewList />
    </box>
  )
}

function IconPreviewList() {
  return (
    <box flexDirection="column" gap={0} minWidth={0} paddingLeft={1}>
      <IconPreviewRow icon="folder" label="Folder" />
      <IconPreviewRow icon="folderOpen" label="Folder open" />
      <IconPreviewRow icon="database" label="Database" />
      <IconPreviewRow icon="table" label="Table" />
    </box>
  )
}

function IconPreviewRow(props: { icon: IconName; label: string }) {
  const theme = useTheme()
  const icon = useIconGlyph(props.icon)

  return (
    <box flexDirection="row" gap={1} minWidth={0}>
      <Text fg={theme.mutedFg} wrapMode="none">
        {icon}
      </Text>
      <Text fg={theme.mutedFg} truncate wrapMode="none">
        - {props.label}
      </Text>
    </box>
  )
}
