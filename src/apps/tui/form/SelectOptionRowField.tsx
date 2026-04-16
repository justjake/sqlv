import type { ReactNode } from "react"

import { FormField, type FieldProps } from "./Field"
import { SelectOptionRowInput, type SelectOptionRowOption } from "./SelectOptionRowInput"

export type SelectOptionRowFieldProps<Value extends string = string> = FieldProps & {
  disabled?: boolean
  hint?: ReactNode
  onChange?: (value: Value) => void
  options: readonly SelectOptionRowOption<Value>[]
  value?: Value
}

export function SelectOptionRowField<Value extends string>(props: SelectOptionRowFieldProps<Value>) {
  const { disabled, hint, onChange, options, value, ...fieldProps } = props

  return (
    <FormField {...fieldProps}>
      {({ active }) => (
        <SelectOptionRowInput
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
