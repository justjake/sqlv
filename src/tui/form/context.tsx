import { createContext, useContext, type ReactNode } from "react"

type FormFieldContextValue = {
  active: boolean
  inputFocused: boolean
}

const FormFieldContext = createContext<FormFieldContextValue>({
  active: false,
  inputFocused: false,
})

export function FormFieldContextProvider(props: {
  value: FormFieldContextValue
  children: ReactNode
}) {
  return <FormFieldContext value={props.value}>{props.children}</FormFieldContext>
}

export function useFormFieldContext(): FormFieldContextValue {
  return useContext(FormFieldContext)
}
