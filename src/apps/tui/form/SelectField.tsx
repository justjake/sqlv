import { FormField, type FieldProps } from "./Field"
import { SelectInput, type SelectInputProps, type SelectOption } from "./SelectInput"

export type SelectFieldProps<Value extends string = string> = FieldProps & {
  disabled?: boolean
  hint?: SelectInputProps<Value>["hint"]
  onChange?: (value: Value) => void
  options: readonly SelectOption<Value>[]
  value?: Value
}

export function SelectField<Value extends string>(props: SelectFieldProps<Value>) {
  const { disabled, hint, onChange, options, value, ...fieldProps } = props

  return (
    <FormField {...fieldProps}>
      {({ active }) => (
        <SelectInput
          active={active}
          disabled={disabled}
          hint={hint}
          onChange={onChange}
          options={options}
          value={value}
        />
      )}
    </FormField>
  )
}
