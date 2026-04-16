import { ConfirmModal } from "./ConfirmModal"
import { usePresentModal } from "./presentModal"

declare const presentModal: ReturnType<typeof usePresentModal>

const confirmModalResult = presentModal(ConfirmModal, {
  children: "Delete this connection?",
  default: "no",
  no: "Cancel",
  yes: "Delete",
})

const expectedConfirmModalResult: Promise<boolean> = confirmModalResult

// @ts-expect-error ConfirmModal resolves a boolean result.
const invalidConfirmModalResult: Promise<string> = confirmModalResult

void expectedConfirmModalResult
void invalidConfirmModalResult
