import type { QuoteCommitmentRefusal, QuoteRequestStatus } from '@endora-commerce/contracts';

/**
 * Issue #167 — whether the quote prices a basket is about to be ordered at are
 * still the seller's commitment **at placement**, not only when the basket was
 * seeded.
 *
 * `quote_requests`' `convert-to-order` refuses a quote whose validity date has
 * passed (`410 QUOTE_VALIDITY_ENDED`) and seeds the basket at the agreed prices
 * otherwise; the basket kept those prices for as long as it lived, so a basket
 * seeded on the quote's last valid day could be ordered at them at any later
 * time. Owner ruling (2026-11-02): **a basket seeded from an expired quote
 * cannot be ordered — a new quote must be issued.** This is that rule, held
 * where the price is consumed.
 *
 * Two questions, kept apart so each is testable on its own:
 *
 * 1. {@link quotesReliedOn} — which quotes the basket's prices rest on. A line
 *    rests on its quote while it holds the quantity the price was agreed for
 *    (`CartItemRecord.quoteSeededQuantity`): that is when `carts` prices it at
 *    the agreement. A line moved off that quantity is priced from the list and
 *    consumes nothing the seller committed to.
 * 2. {@link judgeQuoteCommitments} — whether every one of those quotes is still
 *    in force, read **now** through `quoteRequestReadPort`.
 *
 * Pure: the caller reads the quotes, and decides what a refusal does
 * (placement refuses; the checkout preview reports it).
 */

/** A quote as this rule reads it — the fields of `QuoteRequestRecord` it needs. */
export interface QuoteCommitmentQuote {
  organizationId: string;
  status: QuoteRequestStatus;
  expiresAt: Date | null;
}

/** A basket line as this rule reads it. */
export interface QuoteCommitmentLine {
  quantity: number;
  quoteSeededQuantity: number | null;
  /** The quote the line's agreement came from; absent on a line seeded before lines named it. */
  quoteRequestId?: string | null;
}

export interface QuotesReliedOn {
  /** Each quote a line is priced at the agreement of, once, in basket order. */
  quoteRequestIds: string[];
  /** A line is priced at an agreement and no quote is named for it at all. */
  unattributed: boolean;
}

/**
 * The statuses in which a quote's agreed prices are still the seller's word.
 *
 * `Approved` is the state `convert-to-order` seeds from. `Completed` is the
 * state the first Order placed from the quote moves it to: a second basket of
 * the same quote (two colleagues who each converted it) is placed as an
 * ordinary Order, naming no source (`quote-request-source.ts`,
 * `specs/143-crm-sales-opportunities/` FR-100 … FR-102) — that ruling is about
 * provenance, and changing what it means for the price is not this rule's to
 * decide. Every other status means the commitment was withdrawn or superseded:
 * a revision re-opened (`Pending`, `Created from admin`), or the quote ended
 * (`Canceled`, `Expired`).
 */
const IN_FORCE: ReadonlySet<QuoteRequestStatus> = new Set<QuoteRequestStatus>(['Approved', 'Completed']);

export function quotesReliedOn(
  cart: { sourceQuoteRequestId: string | null },
  items: ReadonlyArray<QuoteCommitmentLine>,
): QuotesReliedOn {
  const ids: string[] = [];
  let unattributed = false;
  for (const item of items) {
    if (item.quoteSeededQuantity === null || item.quantity !== item.quoteSeededQuantity) continue;
    // A line seeded before `cart_items.quote_request_id` existed carries none;
    // its basket's mark is the quote it was seeded from (one seed replaces the
    // whole basket, and the mark is cleared only when the basket empties).
    const id = item.quoteRequestId ?? cart.sourceQuoteRequestId;
    if (!id) {
      unattributed = true;
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { quoteRequestIds: ids, unattributed };
}

/** `quote_requests`' own boundary (`validityHasLapsed`): lapsed at the instant itself. */
export function quoteValidityHasLapsed(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= now.getTime();
}

/**
 * `null` when the basket may be ordered at its quote prices, otherwise why not:
 *
 * - `unavailable` — `quote_requests` is off, so nothing can vouch for an agreed
 *   price (fail-closed, the same reading the minimums exemption takes);
 * - `withdrawn` — the quote is gone, is another Organization's, or is no
 *   longer in a state whose prices bind (see {@link IN_FORCE});
 * - `lapsed` — its validity date has passed.
 */
export function judgeQuoteCommitments(input: {
  organizationId: string;
  relied: QuotesReliedOn;
  quoteDeskPresent: boolean;
  /** Each relied-on quote as read now; `null` when it does not exist. */
  quotes: ReadonlyMap<string, QuoteCommitmentQuote | null>;
  now: Date;
}): QuoteCommitmentRefusal | null {
  const { relied } = input;
  if (relied.quoteRequestIds.length === 0 && !relied.unattributed) return null;
  if (relied.unattributed) return 'withdrawn';
  if (!input.quoteDeskPresent) return 'unavailable';
  let lapsed = false;
  for (const id of relied.quoteRequestIds) {
    const quote = input.quotes.get(id) ?? null;
    if (quote === null || quote.organizationId !== input.organizationId || !IN_FORCE.has(quote.status)) {
      return 'withdrawn';
    }
    if (quoteValidityHasLapsed(quote.expiresAt, input.now)) lapsed = true;
  }
  return lapsed ? 'lapsed' : null;
}
