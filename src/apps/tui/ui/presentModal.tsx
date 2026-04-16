import { flushSync } from "@opentui/react"
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react"

import { useFocusTree } from "../focus/context"

import { ResolvableProvider, type InferResolvableComponentResult } from "./resolvable"

type PresentModalComponent = (props: any) => ReactNode

export type PresentModal<Props = any, Result = unknown> = (
  component: (props: Props) => ReactNode,
  props: Props,
) => Promise<Result>

type InferPresentModalProps<Component extends PresentModalComponent> = Parameters<Component>[0]
type InferPresentedModalResult<Component extends PresentModalComponent> = InferResolvableComponentResult<Component>

type ModalEntry = {
  id: number
  element: ReactElement
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  returnFocusPath?: readonly string[]
}

type ModalPresenterContextValue = {
  count: number
  presentModal: <Component extends PresentModalComponent>(
    component: Component,
    props: InferPresentModalProps<Component>,
  ) => Promise<InferPresentedModalResult<Component>>
}

const ModalPresenterContext = createContext<ModalPresenterContextValue | undefined>(undefined)

export function ModalPresenterProvider(props: { children: ReactNode }) {
  const tree = useFocusTree()
  const nextIdRef = useRef(0)
  const [entries, setEntries] = useState<ModalEntry[]>([])

  const settleEntry = useCallback(
    (id: number, settle: (entry: ModalEntry) => void) => {
      let settled: ModalEntry | undefined
      let remainingEntries: ModalEntry[] | undefined

      flushSync(() => {
        setEntries((current) => {
          const index = current.findIndex((entry) => entry.id === id)
          if (index < 0) {
            return current
          }

          settled = current[index]
          remainingEntries = current.filter((entry) => entry.id !== id)
          return remainingEntries
        })
      })

      if (!settled) {
        return
      }

      settle(settled)

      const returnFocusPath = settled.returnFocusPath
      if ((remainingEntries?.length ?? 0) === 0 && returnFocusPath?.length) {
        queueMicrotask(() => {
          tree.focusPath(returnFocusPath)
        })
      }
    },
    [tree],
  )

  const presentModal = useCallback<ModalPresenterContextValue["presentModal"]>(
    (component, props) => {
      return new Promise((resolve, reject) => {
        const focusedPath = tree.getNavigationState().focusedPath
        const entry: ModalEntry = {
          element: createElement(component, props),
          id: nextIdRef.current + 1,
          reject,
          resolve: resolve as (value: unknown) => void,
          returnFocusPath: focusedPath ? [...focusedPath] : undefined,
        }

        nextIdRef.current = entry.id
        flushSync(() => {
          setEntries((current) => [...current, entry])
        })
      })
    },
    [tree],
  )

  const contextValue = useMemo<ModalPresenterContextValue>(
    () => ({
      count: entries.length,
      presentModal,
    }),
    [entries.length, presentModal],
  )

  return (
    <ModalPresenterContext.Provider value={contextValue}>
      {props.children}
      {entries.map((entry) => (
        <ResolvableProvider
          key={entry.id}
          reject={(error) => {
            settleEntry(entry.id, (settled) => {
              settled.reject(error)
            })
          }}
          resolve={(value) => {
            settleEntry(entry.id, (settled) => {
              settled.resolve(value)
            })
          }}
        >
          {entry.element}
        </ResolvableProvider>
      ))}
    </ModalPresenterContext.Provider>
  )
}

export function usePresentModal() {
  const context = useContext(ModalPresenterContext)
  if (!context) {
    throw new Error("ModalPresenterContext not provided")
  }
  return context.presentModal
}

export function usePresentedModalCount() {
  return useContext(ModalPresenterContext)?.count ?? 0
}
