import {
  INFAKT_DELIVERY_MESSAGES,
  INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE,
  INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE,
} from '@endora-commerce/contracts';

export { INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR };

const KNOWN_MAPPED_SENTENCES = new Set<string>([
  INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE,
  INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE,
  ...Object.values(INFAKT_DELIVERY_MESSAGES),
]);

/**
 * last_error is an operator sentence. Infakt HTTP bodies, header dumps, and
 * vendor plaintext never leave the apply site as stored text.
 */
export function mappedDeliveryError(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return raw ?? null;
  const trimmed = raw.trim();
  if (KNOWN_MAPPED_SENTENCES.has(trimmed)) return trimmed;
  return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
}
