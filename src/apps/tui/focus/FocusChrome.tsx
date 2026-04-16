import { FocusHaloOverlay } from "./context"
import { FocusNavigationHint } from "./FocusNavigationHint"

export function FocusChrome() {
  return (
    <>
      <FocusHaloOverlay />
      <FocusNavigationHint />
    </>
  )
}
