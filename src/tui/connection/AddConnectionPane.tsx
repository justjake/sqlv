import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type {
  AnyAdapter,
  ConnectionField,
  ConnectionFormValues,
  ConnectionSpec,
  ConnectionSpecDraft,
  Protocol,
} from "../../lib/interface/Adapter"
import {
  FocusNavigable,
  FocusNavigableArea,
  focusNavigableRenderableId,
  useFocusTree,
  useIsFocusNavigableHighlighted,
  useIsFocusNavigationActive,
} from "../focus"
import { Shortcut } from "../Shortcut"
import { useTheme } from "../ui/theme"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"

type AddConnectionPaneProps = {
  onBack: () => void
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
  active: boolean
  onPrev: () => void
  onNext: () => void
}

export const ADD_CONNECTION_AREA_ID = "add-connection"

export function AddConnectionPane(props: AddConnectionPaneProps) {
  const { onBack, onSaved } = props
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
  const [activeFieldIndex, setActiveFieldIndex] = useState(1)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  useEffect(() => {
    if (protocol || !initialProtocol) return
    loadProtocol(initialProtocol)
  }, [initialProtocol, protocol])

  const adapter = protocol ? adapters.find((candidate) => candidate.protocol === protocol) : undefined
  const spec = adapter?.getConnectionSpec()
  const visibleFields = spec?.fields.filter((field) => field.visible?.(values) ?? true) ?? []
  const focusFields: FocusField[] = useMemo(
    () => [
      { kind: "protocol", key: "protocol" },
      { kind: "name", key: "name" },
      ...visibleFields.map((field): FocusField => ({ kind: "field", field, key: field.key })),
    ],
    [visibleFields],
  )

  useEffect(() => {
    setActiveFieldIndex((current) => clampIndex(current, focusFields.length, focusFields.length > 1 ? 1 : 0))
  }, [focusFields.length])

  useEffect(() => {
    const activeField = focusFields[activeFieldIndex]
    if (!activeField) {
      return
    }
    const path = addConnectionFieldPath(activeField.key)
    focusTree.setFocusedPath(path)
    scrollRef.current?.scrollChildIntoView(focusNavigableRenderableId(path))
  }, [activeFieldIndex, focusFields, focusTree])

  const focusFieldByIndex = (nextIndex: number) => {
    const clampedIndex = clampIndex(nextIndex, focusFields.length, focusFields.length > 1 ? 1 : 0)
    setActiveFieldIndex(clampedIndex)
  }

  const navigatePrev = () => focusFieldByIndex(stepIndex(activeFieldIndex, focusFields.length, -1))
  const navigateNext = () => focusFieldByIndex(stepIndex(activeFieldIndex, focusFields.length, 1))

  if (!adapters.length) {
    return (
      <box flexDirection="column" gap={1} padding={1}>
        <box flexDirection="row" gap={1}>
          <Shortcut keys="ctrl+c" label="Back" enabled onKey={onBack} />
        </box>
        <text>No connection forms are available for the registered adapters.</text>
      </box>
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

  function loadProtocol(nextProtocol: Protocol) {
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
    setActiveFieldIndex(1)
  }

  function cycleProtocol(step: number) {
    const currentProtocol = protocolRef.current
    if (!currentProtocol || !adapters.length) return
    const index = adapters.findIndex((candidate) => candidate.protocol === currentProtocol)
    if (index < 0) return
    const nextIndex = stepIndex(index, adapters.length, step)
    const nextProtocol = adapters[nextIndex]?.protocol
    if (nextProtocol) loadProtocol(nextProtocol)
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
    <FocusNavigableArea
      flexDirection="column"
      flexGrow={1}
      focusNavigableId={ADD_CONNECTION_AREA_ID}
      onEsc={onBack}
      onEscLabel="Close"
      scrollRef={scrollRef}
      trap
    >
      <box flexDirection="column" flexGrow={1}>
        <box flexDirection="row" gap={1}>
          <Shortcut keys="ctrl+s" label="Save" enabled={!saving} onKey={() => void saveConnection()} />
          <Shortcut keys="ctrl+c" label="Cancel" enabled={!saving} onKey={onBack} />
        </box>

        <scrollbox ref={scrollRef} flexGrow={1} contentOptions={{ flexDirection: "column", gap: 1 }}>
          <text>Add Connection</text>
          {formError && <text>{formError}</text>}

          <FocusNavigable focus={() => focusFieldByIndex(findFieldIndex(focusFields, "protocol"))} focusNavigableId="protocol">
            <ProtocolPicker
              active={focusFields[activeFieldIndex]?.kind === "protocol"}
              adapters={adapters}
              onCycle={cycleProtocol}
              onNext={navigateNext}
              onPrev={navigatePrev}
              protocol={protocol}
            />
          </FocusNavigable>

          <FocusNavigable focus={() => focusFieldByIndex(findFieldIndex(focusFields, "name"))} focusNavigableId="name">
            <TextInputField
              active={focusFields[activeFieldIndex]?.kind === "name"}
              error={errors.name}
              label="Connection Name"
              onChange={(value) => {
                nameRef.current = value
                setName(value)
                clearError("name")
              }}
              onNext={navigateNext}
              onPrev={navigatePrev}
              placeholder={spec?.defaultName}
              value={name}
            />
          </FocusNavigable>

          {visibleFields.map((field) => {
            const isActive =
              focusFields[activeFieldIndex]?.kind === "field" && focusFields[activeFieldIndex]?.key === field.key
            const focus = () => focusFieldByIndex(findFieldIndex(focusFields, field.key))
            switch (field.kind) {
              case "boolean":
                return (
                  <FocusNavigable key={field.key} focus={focus} focusNavigableId={field.key}>
                    <BooleanField
                      active={isActive}
                      checked={booleanField(values, field.key, field.defaultValue ?? false)}
                      description={field.description}
                      error={errors[field.key]}
                      label={field.label}
                      onChange={(value) => updateBooleanField(field.key, value)}
                      onNext={navigateNext}
                      onPrev={navigatePrev}
                    />
                  </FocusNavigable>
                )
              case "text":
              case "path":
              case "secret":
                return (
                  <FocusNavigable key={field.key} focus={focus} focusNavigableId={field.key}>
                    <TextInputField
                      active={isActive}
                      description={field.description}
                      error={errors[field.key]}
                      label={field.label}
                      onChange={(value) => updateStringField(field.key, value)}
                      onNext={navigateNext}
                      onPrev={navigatePrev}
                      placeholder={field.placeholder}
                      value={stringField(values, field.key, field.defaultValue ?? "")}
                    />
                  </FocusNavigable>
                )
              case "select":
                return (
                  <FocusNavigable key={field.key} focus={focus} focusNavigableId={field.key}>
                    <SelectField
                      active={isActive}
                      description={field.description}
                      error={errors[field.key]}
                      field={field}
                      onChange={(value) => updateStringField(field.key, value)}
                      onNext={navigateNext}
                      onPrev={navigatePrev}
                      value={stringField(values, field.key, field.defaultValue ?? "")}
                    />
                  </FocusNavigable>
                )
            }
          })}
        </scrollbox>
      </box>
    </FocusNavigableArea>
  )
}

function ProtocolPicker(
  props: FieldNavProps & {
    adapters: AdapterWithConnectionSpec[]
    protocol: Protocol | undefined
    onCycle: (step: number) => void
  },
) {
  const { active, onPrev, onNext, adapters, protocol, onCycle } = props

  useKeyboard((event) => {
    if (!active) return
    if (handleFieldNav(event, onPrev, onNext)) return
    if (event.name === "right" || event.name === "enter") {
      event.preventDefault()
      event.stopPropagation()
      onCycle(1)
    } else if (event.name === "left") {
      event.preventDefault()
      event.stopPropagation()
      onCycle(-1)
    }
  })

  return (
    <FieldContainer active={active}>
      <text>Protocol</text>
      <text>{adapters.map((adapter) => protocolLabel(adapter, protocol)).join("  ")}</text>
    </FieldContainer>
  )
}

function TextInputField(
  props: FieldNavProps & {
    label: string
    value: string
    placeholder?: string
    description?: string
    error?: string
    onChange: (value: string) => void
  },
) {
  const { active, onPrev, onNext, label, value, placeholder, description, error, onChange } = props
  const theme = useTheme()

  useKeyboard((event) => {
    if (!active) return
    handleFieldNav(event, onPrev, onNext)
  })

  return (
    <FieldContainer active={active}>
      <box flexDirection="row">
        <text>{label} </text>
        <box backgroundColor={theme.inputBg} flexGrow={1}>
          <input focused={active} flexGrow={1} onInput={onChange} placeholder={placeholder} value={value} />
        </box>
      </box>
      {description && <text opacity={0.5}>{description}</text>}
      {error && <text>{error}</text>}
    </FieldContainer>
  )
}

function BooleanField(
  props: FieldNavProps & {
    label: string
    checked: boolean
    description?: string
    error?: string
    onChange: (value: boolean) => void
  },
) {
  const { active, onPrev, onNext, label, checked, description, error, onChange } = props

  useKeyboard((event) => {
    if (!active) return
    if (handleFieldNav(event, onPrev, onNext)) return
    if (event.name === "space" || event.name === "enter") {
      event.preventDefault()
      event.stopPropagation()
      onChange(!checked)
    }
  })

  return (
    <FieldContainer active={active}>
      <box flexDirection="row" justifyContent="space-between" onMouseUp={() => onChange(!checked)}>
        <text>
          {checked ? "◉" : "○"} {label}
        </text>
        {active && <text opacity={0.5}>space toggle</text>}
      </box>
      {description && <text opacity={0.5}>{description}</text>}
      {error && <text>{error}</text>}
    </FieldContainer>
  )
}

function SelectField(
  props: FieldNavProps & {
    field: Extract<ConnectionField, { kind: "select" }>
    value: string
    description?: string
    error?: string
    onChange: (value: string) => void
  },
) {
  const { active, onPrev, onNext, field, value, description, error, onChange } = props

  useKeyboard((event) => {
    if (!active) return
    if (handleFieldNav(event, onPrev, onNext)) return
    if (event.name === "right" || event.name === "enter") {
      event.preventDefault()
      event.stopPropagation()
      cycleOption(1)
    } else if (event.name === "left") {
      event.preventDefault()
      event.stopPropagation()
      cycleOption(-1)
    }
  })

  function cycleOption(step: number) {
    const currentIndex = field.options.findIndex((option) => option.value === value)
    const nextIndex = stepIndex(currentIndex < 0 ? 0 : currentIndex, field.options.length, step)
    const nextValue = field.options[nextIndex]?.value
    if (nextValue !== undefined) onChange(nextValue)
  }

  const displayLabel = field.options.find((option) => option.value === value)?.label ?? value

  return (
    <FieldContainer active={active}>
      <text>{field.label}</text>
      <text>{displayLabel}</text>
      {description && <text opacity={0.5}>{description}</text>}
      {error && <text>{error}</text>}
    </FieldContainer>
  )
}

function FieldContainer(props: { active: boolean; children: ReactNode }) {
  const theme = useTheme()
  const highlighted = useIsFocusNavigableHighlighted()
  const navigationActive = useIsFocusNavigationActive()

  return (
    <box
      backgroundColor={navigationActive && highlighted ? theme.focusNavBg : (props.active ? theme.focusBg : undefined)}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
    </box>
  )
}

function handleFieldNav(event: KeyEvent, onPrev: () => void, onNext: () => void): boolean {
  if (event.name === "tab") {
    event.preventDefault()
    event.stopPropagation()
    event.shift ? onPrev() : onNext()
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

function findFieldIndex(fields: FocusField[], key: string): number {
  const index = fields.findIndex((field) => field.key === key)
  return index < 0 ? 0 : index
}

function protocolLabel(adapter: AdapterWithConnectionSpec, activeProtocol: Protocol | undefined): string {
  if (adapter.protocol === activeProtocol) return `[${adapter.protocol}]`
  return adapter.protocol
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
      !stringField(draft.values, field.key, "").length
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
  if (typeof value !== "string") {
    return defaultValue
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : defaultValue
}
