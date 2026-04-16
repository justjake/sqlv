import type { ReactNode } from "react"

import { CheckboxInput } from "./CheckboxInput"
import { FormField, type FieldProps } from "./Field"

export type CheckboxFieldProps = FieldProps & {
  checked: boolean
  checkedLabel?: ReactNode
  disabled?: boolean
  hint?: ReactNode
  onChange?: (value: boolean) => void
  uncheckedLabel?: ReactNode
}

export function CheckboxField(props: CheckboxFieldProps) {
  const { checked, checkedLabel, disabled, hint, onChange, uncheckedLabel, ...fieldProps } = props

  return (
    <FormField {...fieldProps}>
      {({ active }) => (
        <CheckboxInput
          active={active}
          checked={checked}
          checkedLabel={checkedLabel}
          disabled={disabled}
          hint={hint}
          onChange={onChange}
          uncheckedLabel={uncheckedLabel}
        />
      )}
    </FormField>
  )
}
