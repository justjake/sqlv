import type { InputRenderable, KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { sameFocusPath } from "../../lib/focus"
import type {
  AnyAdapter,
  ConnectionField,
  ConnectionFormValues,
  ConnectionSpec,
  ConnectionSpecDraft,
  Protocol,
} from "../../lib/interface/Adapter"
import {
  Focusable,
  useFocusedDescendantPath,
  useIsFocusNavigationActive,
  useFocusTree,
  useIsFocused,
  useIsHighlighted,
  useIsFocusWithin,
  useRememberedDescendantPath,
} from "../focus"
import { CheckboxInput, FormLabel, RadioSelectRowInput, TextInput } from "../form"
import { Shortcut } from "../Shortcut"
import { useKeybindHandler } from "../ui/keybind"
import { useModalBottomRight } from "../ui/Modal"
import { Text } from "../ui/Text"
import { useTheme } from "../ui/theme"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"

type AddConnectionPaneProps = {
  onSaved: () => void
}

type FocusField =
  | { kind: "protocol"; key: "protocol" }
  | { kind: "name"; key: "name" }
  | { kind: "field"; field: ConnectionField; key: string }

type AdapterWithConnectionSpec = AnyAdapter & {
  getConnectionSpec: () => ConnectionSpec<any>
}

type FieldNavProps = {
  onPrev: () => void
  onNext: () => void
  remembered: boolean
}

export const ADD_CONNECTION_AREA_ID = "add-connection"
const CYCLE_HINT_LABEL = "← ⟶ cycle"

export function AddConnectionPane(props: AddConnectionPaneProps) {
  const { onSaved } = props
  const engine = useSqlVisor()
  const state = useSqlVisorState()
  const focusTree = useFocusTree()
  const adapters = engine.registry.list().filter(hasConnectionSpec)
  const initialProtocol = pickInitialProtocol(adapters, state.selectedConnectionId, state.connections.data)
  const initialSpec = initialProtocol
    ? adapters.find((candidate) => candidate.protocol === initialProtocol)?.getConnectionSpec()
    : undefined
  const [protocol, setProtocol] = useState<Protocol | undefined>(initialProtocol)
  const [name, setName] = useState("")
  const [values, setValues] = useState<ConnectionFormValues>(() => (initialSpec ? defaultFieldValues(initialSpec) : {}))
  const protocolRef = useRef<Protocol | undefined>(initialProtocol)
  const nameRef = useRef("")
  const valuesRef = useRef<ConnectionFormValues>(initialSpec ? defaultFieldValues(initialSpec) : {})
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()
  const scrollRef = useRef<ScrollBoxRenderable>(null)
  const didRequestInitialFocusRef = useRef(false)

  const adapter = protocol ? adapters.find((candidate) => candidate.protocol === protocol) : undefined
  const spec = adapter?.getConnectionSpec()
  const visibleFields = spec?.fields.filter((field) => field.visible?.(values) ?? true) ?? []
  const focusFields: FocusField[] =
    adapters.length === 0
      ? []
      : [
          { kind: "protocol", key: "protocol" },
          { kind: "name", key: "name" },
          ...visibleFields.map((field): FocusField => ({ kind: "field", field, key: field.key })),
        ]

  const loadProtocol = useCallback(
    (nextProtocol: Protocol, focusFieldKey: "name" | "protocol" = "name") => {
      const nextAdapter = adapters.find((candidate) => candidate.protocol === nextProtocol)
      if (!nextAdapter) return

      const nextSpec = nextAdapter.getConnectionSpec()
      protocolRef.current = nextProtocol
      nameRef.current = ""
      valuesRef.current = defaultFieldValues(nextSpec)
      setProtocol(nextProtocol)
      setName("")
      setValues(valuesRef.current)
      setErrors({})
      setFormError(undefined)
      focusTree.focusPath(addConnectionFieldPath(focusFieldKey))
    },
    [adapters, focusTree],
  )

  useEffect(() => {
    if (protocol || !initialProtocol) return
    loadProtocol(initialProtocol)
  }, [initialProtocol, loadProtocol, protocol])

  useEffect(() => {
    if (didRequestInitialFocusRef.current || focusFields.length === 0) {
      return
    }

    didRequestInitialFocusRef.current = true
    focusTree.focusPath(addConnectionFieldPath("name"))
  }, [focusFields.length, focusTree])

  if (!adapters.length) {
    return (
      <Focusable
        alignSelf="stretch"
        childrenNavigable={false}
        delegatesFocus
        flexDirection="column"
        flexGrow={1}
        height="100%"
        focusSelf
        focusable
        focusableId={ADD_CONNECTION_AREA_ID}
        navigable={false}
      >
        <Text>No connection forms are available for the registered adapters.</Text>
      </Focusable>
    )
  }

  async function saveConnection() {
    const currentProtocol = protocolRef.current
    const currentValues = valuesRef.current
    if (!currentProtocol || !spec || saving) return

    const resolvedName = resolveConnectionName(nameRef.current, spec.defaultName)
    const nextErrors = validateDraft(spec, { name: resolvedName, values: currentValues })
    if (hasErrors(nextErrors)) {
      setErrors(nextErrors)
      setFormError(undefined)
      return
    }

    setSaving(true)
    setFormError(undefined)
    try {
      await engine.addConnection({
        config: spec.createConfig(currentValues),
        name: resolvedName,
        protocol: currentProtocol,
      })
      onSaved()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function updateStringField(key: string, nextValue: string) {
    valuesRef.current = { ...valuesRef.current, [key]: nextValue }
    setValues((current) => ({ ...current, [key]: nextValue }))
    clearError(key)
  }

  function updateBooleanField(key: string, nextValue: boolean) {
    valuesRef.current = { ...valuesRef.current, [key]: nextValue }
    setValues((current) => ({ ...current, [key]: nextValue }))
    clearError(key)
  }

  function clearError(key: string) {
    setErrors((current) => ({ ...current, [key]: undefined }))
    setFormError(undefined)
  }

  return (
    <Focusable
      alignSelf="stretch"
      childrenNavigable={false}
      delegatesFocus
      flexDirection="column"
      flexGrow={1}
      height="100%"
      focusSelf
      focusable
      focusableId={ADD_CONNECTION_AREA_ID}
      navigable={false}
      scrollRef={scrollRef}
    >
      <AddConnectionPaneBody
        adapters={adapters}
        errors={errors}
        focusFields={focusFields}
        formError={formError}
        name={name}
        onSelectProtocol={(nextProtocol) => loadProtocol(nextProtocol, "protocol")}
        onSave={() => void saveConnection()}
        onSetName={(value) => {
          nameRef.current = value
          setName(value)
          clearError("name")
        }}
        onSetStringField={updateStringField}
        onSetBooleanField={updateBooleanField}
        protocol={protocol}
        saving={saving}
        scrollRef={scrollRef}
        spec={spec}
        values={values}
      />
    </Focusable>
  )
}

function AddConnectionPaneBody(props: {
  adapters: AdapterWithConnectionSpec[]
  errors: Record<string, string | undefined>
  focusFields: FocusField[]
  formError: string | undefined
  name: string
  onSelectProtocol: (value: Protocol) => void
  onSave: () => void
  onSetName: (value: string) => void
  onSetStringField: (key: string, value: string) => void
  onSetBooleanField: (key: string, value: boolean) => void
  protocol: Protocol | undefined
  saving: boolean
  scrollRef: RefObject<ScrollBoxRenderable | null>
  spec: ConnectionSpec<any> | undefined
  values: ConnectionFormValues
}) {
  const {
    adapters,
    errors,
    focusFields,
    formError,
    name,
    onSelectProtocol,
    onSave,
    onSetBooleanField,
    onSetName,
    onSetStringField,
    protocol,
    saving,
    scrollRef,
    spec,
    values,
  } = props
  const focusTree = useFocusTree()
  const focusedWithin = useIsFocusWithin([ADD_CONNECTION_AREA_ID])
  const focusedFieldPath = useFocusedDescendantPath()
  const rememberedFieldPath = useRememberedDescendantPath()
  const currentFieldKey = resolveDirectChildKey(focusedFieldPath) ?? resolveDirectChildKey(rememberedFieldPath)
  const currentFieldIndex = clampIndex(
    findFieldIndex(focusFields, currentFieldKey ?? "name"),
    focusFields.length,
    focusFields.length > 1 ? 1 : 0,
  )
  const modalBottomRight = useMemo(
    () => <Shortcut keys="ctrl+s" label="Save" enabled={!saving} onKey={onSave} />,
    [onSave, saving],
  )

  useModalBottomRight(modalBottomRight)

  const navigatePrev = () => focusFieldByOffset(-1)
  const navigateNext = () => focusFieldByOffset(1)

  function focusFieldByOffset(step: number) {
    const nextIndex = stepIndex(currentFieldIndex, focusFields.length, step)
    const nextField = focusFields[nextIndex]
    if (!nextField) {
      return
    }
    focusTree.focusPath(addConnectionFieldPath(nextField.key))
  }

  return (
    <scrollbox
      ref={scrollRef}
      alignSelf="stretch"
      flexGrow={1}
      minWidth={0}
      contentOptions={{ flexDirection: "column", gap: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2 }}
    >
      {formError && <Text>{formError}</Text>}

      <ProtocolPickerField
        adapters={adapters}
        onChange={onSelectProtocol}
        onNext={navigateNext}
        onPrev={navigatePrev}
        protocol={protocol}
        remembered={!focusedWithin && sameFocusPath(rememberedFieldPath, addConnectionFieldPath("protocol"))}
      />

      <TextInputField
        error={errors.name}
        focusableId="name"
        label="Connection Name"
        onChange={onSetName}
        onNext={navigateNext}
        onPrev={navigatePrev}
        placeholder={spec?.defaultName}
        remembered={!focusedWithin && sameFocusPath(rememberedFieldPath, addConnectionFieldPath("name"))}
        value={name}
      />

      {spec?.fields.map((field) => {
        if (!(field.visible?.(values) ?? true)) {
          return null
        }

        const remembered = !focusedWithin && sameFocusPath(rememberedFieldPath, addConnectionFieldPath(field.key))
        switch (field.kind) {
          case "boolean":
            return (
              <BooleanField
                key={field.key}
                checked={booleanField(values, field.key, field.defaultValue ?? false)}
                description={field.description}
                error={errors[field.key]}
                fieldFocused={focusedWithin && currentFieldKey === field.key}
                focusableId={field.key}
                label={field.label}
                onChange={(value) => onSetBooleanField(field.key, value)}
                onNext={navigateNext}
                onPrev={navigatePrev}
                remembered={remembered}
              />
            )
          case "text":
          case "path":
          case "secret":
            return (
              <TextInputField
                key={field.key}
                description={field.description}
                error={errors[field.key]}
                focusableId={field.key}
                label={field.label}
                onChange={(value) => onSetStringField(field.key, value)}
                onNext={navigateNext}
                onPrev={navigatePrev}
                placeholder={textFieldPlaceholder(field)}
                remembered={remembered}
                value={stringField(values, field.key, field.defaultValue ?? "")}
              />
            )
          case "select":
            return (
              <SelectField
                key={field.key}
                description={field.description}
                error={errors[field.key]}
                field={field}
                focusableId={field.key}
                onChange={(value) => onSetStringField(field.key, value)}
                onNext={navigateNext}
                onPrev={navigatePrev}
                remembered={remembered}
                value={stringField(values, field.key, field.defaultValue ?? "")}
              />
            )
        }
      })}
    </scrollbox>
  )
}

function ProtocolPickerField(
  props: FieldNavProps & {
    adapters: AdapterWithConnectionSpec[]
    onChange: (value: Protocol) => void
    protocol: Protocol | undefined
  },
) {
  return (
    <Focusable focusable focusableId="protocol">
      <ProtocolPickerBody {...props} />
    </Focusable>
  )
}

function ProtocolPickerBody(
  props: FieldNavProps & {
    adapters: AdapterWithConnectionSpec[]
    onChange: (value: Protocol) => void
    protocol: Protocol | undefined
  },
) {
  const { onPrev, onNext, adapters, onChange, protocol, remembered } = props
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = navigationActive ? highlighted : focused

  useKeybindHandler({
    enabled: focused,
    detect: isFieldNavKey,
    onKey(event) {
      handleFieldNav(event, onPrev, onNext)
    },
  })

  return (
    <FormLabel
      active={active || remembered}
      description="Pick the adapter that will own this connection."
      inputFocused={!navigationActive && focused}
      name="Protocol"
    >
      <RadioSelectRowInput
        hint={CYCLE_HINT_LABEL}
        onChange={onChange}
        options={adapters.map((adapter) => ({ key: adapter.protocol, label: adapter.protocol, value: adapter.protocol }))}
        value={protocol}
      />
    </FormLabel>
  )
}

function TextInputField(
  props: FieldNavProps & {
    focusableId: string
    label: string
    value: string
    placeholder?: string
    description?: string
    error?: string
    onChange: (value: string) => void
  },
) {
  const { description, error, focusableId, label, onChange, onNext, onPrev, placeholder, remembered, value } = props
  const inputRef = useRef<InputRenderable>(null)

  return (
    <Focusable applyFocus={() => inputRef.current?.focus()} focusable focusableId={focusableId}>
      <TextInputFieldBody
        description={description}
        error={error}
        inputRef={inputRef}
        label={label}
        onChange={onChange}
        onNext={onNext}
        onPrev={onPrev}
        placeholder={placeholder}
        remembered={remembered}
        value={value}
      />
    </Focusable>
  )
}

function TextInputFieldBody(props: {
  description?: string
  error?: string
  inputRef: RefObject<InputRenderable | null>
  label: string
  onChange: (value: string) => void
  onNext: () => void
  onPrev: () => void
  placeholder?: string
  remembered: boolean
  value: string
}) {
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = navigationActive ? highlighted : focused

  useKeybindHandler({
    enabled: focused,
    detect: isFieldNavKey,
    onKey(event) {
      handleFieldNav(event, props.onPrev, props.onNext)
    },
  })

  return (
    <FormLabel
      active={active || props.remembered}
      description={props.description}
      error={props.error}
      inputFocused={!navigationActive && focused}
      name={props.label}
    >
      <TextInput
        inputRef={props.inputRef}
        onInput={props.onChange}
        placeholder={props.placeholder}
        value={props.value}
      />
    </FormLabel>
  )
}

function BooleanField(
  props: FieldNavProps & {
    focusableId: string
    label: string
    checked: boolean
    fieldFocused: boolean
    description?: string
    error?: string
    onChange: (value: boolean) => void
  },
) {
  return (
    <Focusable focusable focusableId={props.focusableId}>
      <BooleanFieldBody {...props} />
    </Focusable>
  )
}

function BooleanFieldBody(
  props: FieldNavProps & {
    label: string
    checked: boolean
    fieldFocused: boolean
    description?: string
    error?: string
    onChange: (value: boolean) => void
  },
) {
  const { checked, description, error, fieldFocused, label, onChange, onNext, onPrev, remembered } = props
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = navigationActive ? highlighted : focused
  const fieldActive = fieldFocused || active || remembered

  useKeybindHandler({
    enabled: focused,
    detect: isFieldNavKey,
    onKey(event) {
      if (handleFieldNav(event, onPrev, onNext)) return
    },
  })

  return (
    <FormLabel
      active={fieldActive}
      description={description}
      error={error}
      inputFocused={fieldFocused || (!navigationActive && focused)}
      name={label}
    >
      <CheckboxInput checked={checked} hint="space toggle" onChange={onChange} />
    </FormLabel>
  )
}

function SelectField(
  props: FieldNavProps & {
    focusableId: string
    field: Extract<ConnectionField, { kind: "select" }>
    value: string
    description?: string
    error?: string
    onChange: (value: string) => void
  },
) {
  return (
    <Focusable focusable focusableId={props.focusableId}>
      <SelectFieldBody {...props} />
    </Focusable>
  )
}

function SelectFieldBody(
  props: FieldNavProps & {
    field: Extract<ConnectionField, { kind: "select" }>
    value: string
    description?: string
    error?: string
    onChange: (value: string) => void
  },
) {
  const { description, error, field, onChange, onNext, onPrev, remembered, value } = props
  const focused = useIsFocused()
  const highlighted = useIsHighlighted()
  const navigationActive = useIsFocusNavigationActive()
  const active = navigationActive ? highlighted : focused
  const theme = useTheme()

  useKeybindHandler({
    enabled: focused,
    detect(event) {
      return isFieldNavKey(event) || event.name === "left" || event.name === "right" || event.name === "enter" || event.name === "return"
    },
    onKey(event) {
      if (handleFieldNav(event, onPrev, onNext)) return
      if (event.name === "right" || event.name === "enter" || event.name === "return") {
        event.preventDefault()
        event.stopPropagation()
        cycleOption(1)
      } else if (event.name === "left") {
        event.preventDefault()
        event.stopPropagation()
        cycleOption(-1)
      }
    },
  })

  function cycleOption(step: number) {
    const currentIndex = field.options.findIndex((option) => option.value === value)
    const nextIndex = stepIndex(currentIndex < 0 ? 0 : currentIndex, field.options.length, step)
    const nextValue = field.options[nextIndex]?.value
    if (nextValue !== undefined) onChange(nextValue)
  }

  const displayLabel = field.options.find((option) => option.value === value)?.label ?? value

  return (
    <FormLabel active={active || remembered} description={description} error={error} name={field.label}>
      <box alignSelf="stretch" flexDirection="row" gap={1} minWidth={0}>
        <Text flexGrow={1} flexShrink={1} truncate wrapMode="none">
          {displayLabel}
        </Text>
        {focused && !navigationActive && <Text fg={theme.mutedFg}>{CYCLE_HINT_LABEL}</Text>}
      </box>
    </FormLabel>
  )
}

function isFieldNavKey(event: KeyEvent): boolean {
  return event.name === "tab" || event.name === "up" || event.name === "down"
}

function handleFieldNav(event: KeyEvent, onPrev: () => void, onNext: () => void): boolean {
  if (event.name === "tab") {
    event.preventDefault()
    event.stopPropagation()
    if (event.shift) {
      onPrev()
    } else {
      onNext()
    }
    return true
  }
  if (event.name === "up") {
    event.preventDefault()
    event.stopPropagation()
    onPrev()
    return true
  }
  if (event.name === "down") {
    event.preventDefault()
    event.stopPropagation()
    onNext()
    return true
  }
  return false
}

function hasConnectionSpec(adapter: AnyAdapter): adapter is AdapterWithConnectionSpec {
  return typeof adapter.getConnectionSpec === "function"
}

function pickInitialProtocol(
  adapters: AdapterWithConnectionSpec[],
  selectedConnectionId: string | undefined,
  connections: Array<{ id: string; protocol: Protocol }> | undefined,
): Protocol | undefined {
  const selectedProtocol = connections?.find((connection) => connection.id === selectedConnectionId)?.protocol
  if (selectedProtocol && adapters.some((adapter) => adapter.protocol === selectedProtocol)) {
    return selectedProtocol
  }
  return adapters[0]?.protocol
}

function addConnectionFieldPath(key: string) {
  return [ADD_CONNECTION_AREA_ID, key] as const
}

function resolveDirectChildKey(path: readonly string[] | undefined): string | undefined {
  if (!path || path[0] !== ADD_CONNECTION_AREA_ID || path.length !== 2) {
    return undefined
  }
  return path[1]
}

function findFieldIndex(fields: FocusField[], key: string): number {
  const index = fields.findIndex((field) => field.key === key)
  return index < 0 ? 0 : index
}

function defaultFieldValues(spec: ConnectionSpec<any>): ConnectionFormValues {
  const values: ConnectionFormValues = {}
  for (const field of spec.fields) values[field.key] = field.defaultValue
  return values
}

function validateDraft(spec: ConnectionSpec<any>, draft: ConnectionSpecDraft): Record<string, string | undefined> {
  const errors: Record<string, string | undefined> = {}
  if (!draft.name.trim()) errors.name = "Connection name is required."
  for (const field of spec.fields) {
    if (!(field.visible?.(draft.values) ?? true)) continue
    if (
      (field.kind === "text" || field.kind === "path" || field.kind === "secret") &&
      field.required &&
      !stringField(draft.values, field.key, "").trim().length
    ) {
      errors[field.key] = `${field.label} is required.`
    }
  }
  if (spec.validate) {
    const validationErrors = spec.validate(draft)
    for (const [key, value] of Object.entries(validationErrors)) errors[key] = value
  }
  return errors
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => value !== undefined)
}

function resolveConnectionName(name: string, defaultName: string | undefined): string {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : (defaultName?.trim() ?? "")
}

function clampIndex(index: number, length: number, fallback = 0): number {
  if (length <= 0) return 0
  if (index < 0) return fallback
  if (index >= length) return length - 1
  return index
}

function stepIndex(index: number, length: number, step: number): number {
  if (length <= 0) return 0
  return (index + step + length) % length
}

function booleanField(values: ConnectionFormValues, key: string, defaultValue: boolean): boolean {
  const value = values[key]
  return typeof value === "boolean" ? value : defaultValue
}

function stringField(values: ConnectionFormValues, key: string, defaultValue: string): string {
  const value = values[key]
  return typeof value === "string" ? value : defaultValue
}

function textFieldPlaceholder(
  field: Extract<ConnectionField, { kind: "text" | "path" | "secret" }>,
): string | undefined {
  return field.defaultValue === undefined || field.defaultValue === "" ? field.placeholder : undefined
}
