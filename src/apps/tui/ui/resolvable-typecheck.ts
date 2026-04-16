import { ConfirmModal } from "./ConfirmModal"
import type { InferResolvableComponentResult } from "./resolvable"

const confirmModalResult: InferResolvableComponentResult<typeof ConfirmModal> = true

// @ts-expect-error ConfirmModal resolves a boolean result.
const invalidConfirmModalResult: InferResolvableComponentResult<typeof ConfirmModal> = "no"

void confirmModalResult
void invalidConfirmModalResult
