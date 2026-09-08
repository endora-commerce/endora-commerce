export const INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR =
  'The ledger vendor returned an unreadable error.';

/**
 * last_error is an operator sentence. Infakt HTTP bodies and header dumps
 * never leave the vendor adapter; this is the list/read safety net if one
 * is planted on the row.
 */
export function mappedDeliveryError(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return raw ?? null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) {
    return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  }
  if (/<html|"errors"|X-inFakt|api_key/i.test(trimmed)) {
    return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  }
  return trimmed;
}
