import { createContext, useContext, useMemo, type ReactNode } from "react"

declare const resolvableBrandSymbol: unique symbol

export type ResolvableBrand<T> = {
  readonly [resolvableBrandSymbol]?: T
}

export type InferResolvableResult<T> = T extends ResolvableBrand<infer Result> ? Result : never

export type InferResolvableComponentResult<Component extends (...args: any[]) => unknown> = InferResolvableResult<
  ReturnType<Component>
>

export type ResolvableResolver<T> = {
  <const R>(branded: R): R & ResolvableBrand<T>
  readonly resolve: ((value: T) => void) | undefined
  readonly resolveAs: (value: T) => (() => void) | undefined
  readonly reject: ((error: Error) => void) | undefined
  readonly rejectAs: (error: Error) => (() => void) | undefined
}

export function createResolvableResolver<T>(handlers: {
  resolve?: (value: T) => void
  reject?: (error: Error) => void
}): ResolvableResolver<T> {
  const resolve = handlers.resolve
  const reject = handlers.reject

  const resolver = ((branded) => branded as typeof branded & ResolvableBrand<T>) as ResolvableResolver<T>

  return Object.assign(resolver, {
    reject,
    rejectAs(error: Error) {
      return reject ? () => reject(error) : undefined
    },
    resolve,
    resolveAs(value: T) {
      return resolve ? () => resolve(value) : undefined
    },
  })
}

export const noOpResolver = createResolvableResolver<never>({})

export const ResolvableContext = createContext<ResolvableResolver<never>>(noOpResolver)

export function ResolvableProvider<T>(props: {
  children: ReactNode
  resolve?: (value: T) => void
  reject?: (error: Error) => void
}) {
  const resolver = useMemo(
    () =>
      createResolvableResolver<T>({
        reject: props.reject,
        resolve: props.resolve,
      }),
    [props.reject, props.resolve],
  )

  return <ResolvableContext value={resolver as ResolvableResolver<never>}>{props.children}</ResolvableContext>
}

export function useResolvable<T>(): ResolvableResolver<T> {
  return useContext(ResolvableContext) as ResolvableResolver<T>
}
