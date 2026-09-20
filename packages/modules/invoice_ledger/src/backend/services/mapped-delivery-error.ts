import { INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR } from '@endora-commerce/contracts';

/**
 * The longest sentence a ledger vendor is expected to author is well under
 * this; the bound is a backstop against a body that happens to carry no
 * markup, not a budget anyone should design against. A vendor that composes a
 * sentence bounds its own composition — see `formatWfirmaValidationError`.
 */
const MAX_OPERATOR_SENTENCE_LENGTH = 500;

// C0, DEL and C1. A newline, a carriage return and a tab are the interesting
// members: they are what a header dump and a stack trace are made of.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * A **vendor-independent shape floor** over `last_error` — D-256
 * (`specs/080-f4-real-scope/rulings.md`).
 *
 * The promise is *"no dump reaches the stored field"*, **not** *"only these
 * sentences do"*. The vendor that authors an operator sentence owns both the
 * vocabulary and the mapping that produces it; this module holds no vendor
 * vocabulary and recognises no vendor sentence. What it refuses is a shape no
 * operator sentence has: markup, a control character, a serialised body, or a
 * length no sentence reaches. Anything else is stored as the vendor wrote it —
 * including prose this module has never seen. Each vendor asserts, in its own
 * package and beside its own vocabulary, that every sentence it can hand the
 * ledger clears this floor.
 *
 * Refusal is whole: an input that fails a clause becomes
 * `INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR`, never a prefix of itself. Half a
 * sentence is prose nobody wrote and can cut a leaked token in two.
 *
 * **Scope.** This is the `last_error` column and nothing else. The neighbouring
 * `attempts[].error` JSONB is stored as it arrives and returned as stored by
 * `POST /api/v1/admin/invoice-ledger/deliveries/:id/retry` — outside this
 * floor, recorded in `specs/deferred-defects.md`.
 */
export function mappedDeliveryError(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return raw ?? null;
  const trimmed = raw.trim();
  // Whitespace-only is not an operator sentence, and storing `''` on a failed
  // row would read as "no error". Today's answer, kept.
  if (trimmed === '') return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  if (trimmed.includes('<') || trimmed.includes('>')) return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  if (CONTROL_CHARACTER.test(trimmed)) return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  }
  if (trimmed.length > MAX_OPERATOR_SENTENCE_LENGTH) return INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR;
  return trimmed;
}
