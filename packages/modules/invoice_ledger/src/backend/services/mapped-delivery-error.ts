import {
  INFAKT_DELIVERY_MESSAGES,
  INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE,
  INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE,
  WFIRMA_DELIVERY_MESSAGES,
} from '@endora-commerce/contracts';

const KNOWN_MAPPED_SENTENCES = new Set<string>([
  INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR,
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  INVOICE_LEDGER_ASYNC_CREATE_FAILED_MESSAGE,
  INVOICE_LEDGER_VENDOR_KSEF_SEND_FAILED_MESSAGE,
  ...Object.values(INFAKT_DELIVERY_MESSAGES),
  ...Object.values(WFIRMA_DELIVERY_MESSAGES),
]);

const WFIRMA_VALIDATION_PREFIX = `${WFIRMA_DELIVERY_MESSAGES.validationRejected} `;

function isMappedWfirmaValidationSentence(trimmed: string): boolean {
  if (!trimmed.startsWith(WFIRMA_VALIDATION_PREFIX)) return false;
  const tail = trimmed.slice(WFIRMA_VALIDATION_PREFIX.length);
  return tail !== '' && !tail.includes('<') && !tail.includes('>');
}

/**
 * last_error is an operator sentence. Infakt HTTP bodies, header dumps, and
 * vendor plaintext never leave the apply site as stored text.
 */
export function mappedDeliveryError(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return raw ?? null;
  const trimmed = raw.trim();
  if (trimmed.includes('<') || trimmed.includes('>')) return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  if (KNOWN_MAPPED_SENTENCES.has(trimmed)) return trimmed;
  if (isMappedWfirmaValidationSentence(trimmed)) return trimmed;
  return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
}
