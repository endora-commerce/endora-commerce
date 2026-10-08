import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The one rule every route into an order shares: a quote line is sold at the
 * unit price the seller agreed, and a line the seller has not priced has no
 * price at all.
 *
 * `agreedUnitPrice` is written only by an operator — `RfqAdminService.modify`
 * and `createOnBehalf` — and stays `null` until one of them sets it. `null` is
 * therefore "not priced yet" and is never read as a number: there is no
 * fallback to zero, to the buyer's desired price or to the list price anywhere
 * in this module.
 *
 * **Missing, not zero.** Both admin schemas accept `agreedUnitPrice: 0`
 * (`nonnegative()`), so a price of exactly zero is something an operator typed
 * — a free sample line — and is an agreed price like any other.
 */
export function hasUnpricedLine(
  items: ReadonlyArray<{ agreedUnitPrice?: string | null }>,
): boolean {
  return items.some((it) => it.agreedUnitPrice == null);
}

/** The refusal the three guards answer with — one code, one sentence. */
export function quoteIncompleteError(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.QUOTE_INCOMPLETE,
    'Quote Request has a line with no agreed unit price.',
  );
}
