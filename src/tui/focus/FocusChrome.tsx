import { FocusNavigationHint } from "./FocusNavigationHint"
import { FocusHaloOverlay } from "./context"

export function FocusChrome() {
  return (
    <>
      <FocusHaloOverlay />
      <FocusNavigationHint />
    </>
  )
}
