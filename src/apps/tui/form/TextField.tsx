import { FormField, type FieldProps } from "./Field"
import { TextInput } from "./TextInput"

export type TextFieldProps = FieldProps & {
  disabled?: boolean
  onChange: (value: string) => void
  placeholder?: string
  value: string
}

export function TextField(props: TextFieldProps) {
  const { disabled, onChange, placeholder, value, ...fieldProps } = props

  return (
    <FormField {...fieldProps}>
      {({ active }) => (
        <TextInput active={active} disabled={disabled} onInput={onChange} placeholder={placeholder} value={value} />
      )}
    </FormField>
  )
}
