import type { QuoteRequestSourceRefusal } from './quote-request-source.js';
import { quoteValidityHasLapsed } from './quote-commitment.js';

/**
 * Feature 155 (FR-036; research R19 step 3; threat F2) — whether a basket's
 * quote-seeded lines keep their exemption from the catalogue's order minimums
 * at the checkout preview and at placement.
 *
 * The cart takes the basket's quote mark at face value (FR-028); this is where
 * it stops being taken on trust. Exemptions are honoured only when both hold:
 *
 * - `judgeQuoteRequestSource` accepts the source — the request exists, is
 *   the placing Organization's, is `Approved`, no Order names it yet, and the
 *   basket still holds an agreed line at its agreed price;
 * - **and** the quote's validity has not lapsed: `expiresAt` is unset or still
 *   ahead of `now`.
 *
 * The second rule is the one `quote_requests` applies when it seeds the basket
 * (`validityHasLapsed` in its `rfq-service.ts`), restated here rather than
 * imported — it is private to that module (Principle I). It is deliberately
 * not folded into the judge: the provenance stamp keeps today's judgement, so
 * whether an order of a lapsed quote still names its source is unchanged.
 *
 * Pure. Otherwise every line is judged like any basket line.
 */
export function quoteSourceHonoursExemptions(
  judged: { accepted: true } | { accepted: false; reason: QuoteRequestSourceRefusal },
  quoteRequest: { expiresAt: Date | null } | null,
  now: Date,
): boolean {
  if (!judged.accepted || quoteRequest === null) return false;
  return !quoteValidityHasLapsed(quoteRequest.expiresAt, now);
}
