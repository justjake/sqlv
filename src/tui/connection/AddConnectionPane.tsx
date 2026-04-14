import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type {
  AnyAdapter,
  ConnectionField,
  ConnectionFormValues,
  ConnectionSpec,
  ConnectionSpecDraft,
  Protocol,
} from "../../lib/interface/Adapter"
import { Shortcut } from "../Shortcut"
import { useSqlVisor, useSqlVisorState } from "../useSqlVisor"

type AddConnectionPaneProps = {
  onBack: () => void
  onSaved: () => void
}

type ProtocolFocusField = {
  kind: "protocol"
  key: "protocol"
}

type NameFocusField = {
  kind: "name"
  key: "name"
}

type ConfigFocusField = {
  kind: "field"
  field: ConnectionField
  key: string
}

type FocusField = ProtocolFocusField | NameFocusField | ConfigFocusField

type AdapterWithConnectionSpec = AnyAdapter & {
  getConnectionSpec: () => ConnectionSpec<any>
}

export function AddConnectionPane(props: AddConnectionPaneProps) {
  const { onBack, onSaved } = props
  const engine = useSqlVisor()
  const state = useSqlVisorState()
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
  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | undefined>()
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  useEffect(() => {
    if (protocol || !initialProtocol) {
      return
    }

    loadProtocol(initialProtocol)
  }, [initialProtocol, protocol])

  const adapter = protocol ? adapters.find((candidate) => candidate.protocol === protocol) : undefined
  const spec = adapter?.getConnectionSpec()
  const visibleFields = spec?.fields.filter((field) => field.visible?.(values) ?? true) ?? []
  const focusFields: FocusField[] = [
    { kind: "protocol", key: "protocol" },
    { kind: "name", key: "name" },
    ...visibleFields.map(
      (field): ConfigFocusField => ({
        field,
        key: field.key,
        kind: "field",
      }),
    ),
  ]

  useEffect(() => {
    setActiveFieldIndex((current) => clampIndex(current, focusFields.length))
  }, [focusFields.length])

  useEffect(() => {
    const activeField = focusFields[activeFieldIndex]
    if (activeField && scrollRef.current) {
      scrollRef.current.scrollChildIntoView(`field-${activeField.key}`)
    }
  }, [activeFieldIndex])

  useKeyboard((event) => {
    if (!focusFields.length) {
      return
    }

    if (event.ctrl && event.name === "s") {
      event.preventDefault()
      event.stopPropagation()
      void saveConnection()
      return
    }

    if ((event.ctrl && event.name === "c") || event.name === "escape") {
      event.preventDefault()
      event.stopPropagation()
      onBack()
      return
    }

    if (event.name === "tab") {
      event.preventDefault()
      event.stopPropagation()
      setActiveFieldIndex((current) => stepIndex(current, focusFields.length, event.shift ? -1 : 1))
      return
    }

    const activeField = focusFields[activeFieldIndex]
    if (!activeField) {
      return
    }

    if (activeField.kind === "protocol") {
      if (isNextOptionKey(event.name)) {
        event.preventDefault()
        event.stopPropagation()
        cycleProtocol(1)
      } else if (isPreviousOptionKey(event.name)) {
        event.preventDefault()
        event.stopPropagation()
        cycleProtocol(-1)
      }
      return
    }

    if (activeField.kind === "field" && activeField.field.kind === "boolean") {
      if (isToggleKey(event.name)) {
        event.preventDefault()
        event.stopPropagation()
        updateBooleanField(activeField.field.key, !booleanField(values, activeField.field.key, false))
      }
      return
    }

    if (activeField.kind === "field" && activeField.field.kind === "select") {
      if (isNextOptionKey(event.name)) {
        event.preventDefault()
        event.stopPropagation()
        stepSelectField(activeField.field, 1)
      } else if (isPreviousOptionKey(event.name)) {
        event.preventDefault()
        event.stopPropagation()
        stepSelectField(activeField.field, -1)
      }
    }
  })

  if (!adapters.length) {
    return (
      <box flexDirection="column" gap={1} padding={1}>
        <box flexDirection="row" gap={1}>
          <Shortcut label="Back" enabled name="escape" onKey={onBack} />
        </box>
        <text>No connection forms are available for the registered adapters.</text>
      </box>
    )
  }

  async function saveConnection() {
    const currentProtocol = protocolRef.current
    const currentValues = valuesRef.current

    if (!currentProtocol || !spec || saving) {
      return
    }

    const resolvedName = resolveConnectionName(nameRef.current, spec.defaultName)
    const nextErrors = validateDraft(spec, {
      name: resolvedName,
      values: currentValues,
    })
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
    if (!nextAdapter) {
      return
    }

    const nextSpec = nextAdapter.getConnectionSpec()
    protocolRef.current = nextProtocol
    nameRef.current = ""
    valuesRef.current = defaultFieldValues(nextSpec)
    setProtocol(nextProtocol)
    setName("")
    setValues(valuesRef.current)
    setErrors({})
    setFormError(undefined)
    setActiveFieldIndex(0)
  }

  function cycleProtocol(step: number) {
    const currentProtocol = protocolRef.current
    if (!currentProtocol || !adapters.length) {
      return
    }

    const index = adapters.findIndex((candidate) => candidate.protocol === currentProtocol)
    if (index < 0) {
      return
    }

    const nextIndex = stepIndex(index, adapters.length, step)
    const nextProtocol = adapters[nextIndex]?.protocol
    if (nextProtocol) {
      loadProtocol(nextProtocol)
    }
  }

  function stepSelectField(field: Extract<ConnectionField, { kind: "select" }>, step: number) {
    const currentValue = stringField(values, field.key, field.defaultValue ?? field.options[0]?.value ?? "")
    const currentIndex = field.options.findIndex((option) => option.value === currentValue)
    const nextIndex = stepIndex(currentIndex < 0 ? 0 : currentIndex, field.options.length, step)
    const nextValue = field.options[nextIndex]?.value
    if (nextValue !== undefined) {
      updateStringField(field.key, nextValue)
    }
  }

  function updateStringField(key: string, nextValue: string) {
    valuesRef.current = {
      ...valuesRef.current,
      [key]: nextValue,
    }
    setValues((current) => ({
      ...current,
      [key]: nextValue,
    }))
    clearError(key)
  }

  function updateBooleanField(key: string, nextValue: boolean) {
    valuesRef.current = {
      ...valuesRef.current,
      [key]: nextValue,
    }
    setValues((current) => ({
      ...current,
      [key]: nextValue,
    }))
    clearError(key)
  }

  function clearError(key: string) {
    setErrors((current) => ({
      ...current,
      [key]: undefined,
    }))
    setFormError(undefined)
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box flexDirection="row" gap={1}>
        <Shortcut ctrl enabled={!saving} label="Save" name="s" onKey={() => void saveConnection()} />
        <Shortcut ctrl enabled={!saving} label="Cancel" name="c" onKey={onBack} />
        <Shortcut enabled={!saving} label="Back" name="escape" onKey={onBack} />
      </box>

      <scrollbox ref={scrollRef} flexGrow={1} contentOptions={{ flexDirection: "column", gap: 1 }}>
        <text>Add Connection</text>
        {formError && <text>{formError}</text>}

        <FieldContainer active={focusFields[activeFieldIndex]?.kind === "protocol"} id="field-protocol">
          <text>Protocol</text>
          <text>{adapters.map((candidate) => protocolLabel(candidate, protocol)).join("  ")}</text>
        </FieldContainer>

        <FieldContainer active={focusFields[activeFieldIndex]?.kind === "name"} id="field-name">
          <text>Connection Name</text>
          <input
            focused={focusFields[activeFieldIndex]?.kind === "name"}
            onInput={setNameAndClearError}
            placeholder={spec?.defaultName}
            value={name}
          />
          {errors.name && <text>{errors.name}</text>}
        </FieldContainer>

        {visibleFields.map((field) => {
          const isActive =
            focusFields[activeFieldIndex]?.kind === "field" && focusFields[activeFieldIndex]?.key === field.key
          return (
            <FieldContainer active={isActive} id={`field-${field.key}`} key={field.key}>
              <text>{field.label}</text>
              {renderField(field, values, isActive, updateBooleanField, updateStringField)}
              {field.description && <text>{field.description}</text>}
              {errors[field.key] && <text>{errors[field.key]}</text>}
            </FieldContainer>
          )
        })}
      </scrollbox>
    </box>
  )

  function setNameAndClearError(nextName: string) {
    nameRef.current = nextName
    setName(nextName)
    clearError("name")
  }
}

function FieldContainer(props: { active: boolean; children: ReactNode; id?: string }) {
  return (
    <box
      backgroundColor={props.active ? "blue" : undefined}
      flexDirection="column"
      id={props.id}
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
    </box>
  )
}

function renderField(
  field: ConnectionField,
  values: ConnectionFormValues,
  focused: boolean,
  updateBooleanField: (key: string, nextValue: boolean) => void,
  updateStringField: (key: string, nextValue: string) => void,
) {
  switch (field.kind) {
    case "text":
    case "path":
    case "secret":
      return (
        <input
          focused={focused}
          onInput={(nextValue) => updateStringField(field.key, nextValue)}
          placeholder={field.placeholder}
          value={stringField(values, field.key, field.defaultValue ?? "")}
        />
      )
    case "boolean":
      return (
        <box
          onMouseUp={() => updateBooleanField(field.key, !booleanField(values, field.key, field.defaultValue ?? false))}
        >
          <text>[{booleanField(values, field.key, field.defaultValue ?? false) ? "x" : " "}]</text>
        </box>
      )
    case "select":
      return <text>{selectLabel(field, stringField(values, field.key, field.defaultValue ?? ""))}</text>
  }
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

function protocolLabel(adapter: AdapterWithConnectionSpec, activeProtocol: Protocol | undefined): string {
  if (adapter.protocol === activeProtocol) {
    return `[${adapter.protocol}]`
  }
  return adapter.protocol
}

function defaultFieldValues(spec: ConnectionSpec<any>): ConnectionFormValues {
  const values: ConnectionFormValues = {}
  for (const field of spec.fields) {
    values[field.key] = field.defaultValue
  }
  return values
}

function validateDraft(spec: ConnectionSpec<any>, draft: ConnectionSpecDraft): Record<string, string | undefined> {
  const errors: Record<string, string | undefined> = {}
  if (!draft.name.trim()) {
    errors.name = "Connection name is required."
  }

  for (const field of spec.fields) {
    if (!(field.visible?.(draft.values) ?? true)) {
      continue
    }
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
    for (const [key, value] of Object.entries(validationErrors)) {
      errors[key] = value
    }
  }
  return errors
}

function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => value !== undefined)
}

function resolveConnectionName(name: string, defaultName: string | undefined): string {
  const trimmed = name.trim()
  if (trimmed.length > 0) {
    return trimmed
  }
  return defaultName?.trim() ?? ""
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0
  }
  if (index < 0) {
    return 0
  }
  if (index >= length) {
    return length - 1
  }
  return index
}

function stepIndex(index: number, length: number, step: number): number {
  if (length <= 0) {
    return 0
  }
  return (index + step + length) % length
}

function isNextOptionKey(name: string): boolean {
  return name === "right" || name === "down" || name === "enter"
}

function isPreviousOptionKey(name: string): boolean {
  return name === "left" || name === "up"
}

function isToggleKey(name: string): boolean {
  return name === "space" || name === "enter"
}

function booleanField(values: ConnectionFormValues, key: string, defaultValue: boolean): boolean {
  const value = values[key]
  return typeof value === "boolean" ? value : defaultValue
}

function stringField(values: ConnectionFormValues, key: string, defaultValue: string): string {
  const value = values[key]
  return typeof value === "string" ? value : defaultValue
}

function selectLabel(field: Extract<ConnectionField, { kind: "select" }>, currentValue: string): string {
  return field.options.find((option) => option.value === currentValue)?.label ?? currentValue
}
