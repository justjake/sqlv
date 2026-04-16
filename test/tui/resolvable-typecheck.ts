import { ConfirmModal } from "../../src/apps/tui/ui/ConfirmModal"
import type { InferResolvableComponentResult } from "../../src/apps/tui/ui/resolvable"

const confirmModalResult: InferResolvableComponentResult<typeof ConfirmModal> = true

// @ts-expect-error ConfirmModal resolves a boolean result.
const invalidConfirmModalResult: InferResolvableComponentResult<typeof ConfirmModal> = "no"

void confirmModalResult
void invalidConfirmModalResult
