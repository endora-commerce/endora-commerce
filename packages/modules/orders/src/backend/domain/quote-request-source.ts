import type { QuoteRequestStatus } from '@endora-commerce/contracts';

/**
 * Whether an Order may name the Quote Request its basket claims to have been
 * seeded from (`specs/143-crm-sales-opportunities/`, FR-100 … FR-102).
 *
 * The basket carries the claim — `carts.source_quote_request_id`, written by
 * `quote_requests`' conversion and by nothing a buyer can reach — and this is
 * where it is judged, at placement, against the request as it is **now**. Pure
 * on purpose: the three readers of `orders.source_quote_request_id` each act
 * on it without asking again (`quote_requests` completes the request, `crm`
 * links the Order to the request's Opportunity and stops counting the request),
 * so what is stamped has to be decided once and in one place.
 *
 * Every refusal is the same answer — no source — and never a refused
 * placement: the buyer is ordering a basket they are allowed to order, and
 * only the provenance is in doubt.
 */

/** The state in which `quote_requests` lets a request be converted. */
const CONVERTIBLE_STATUS: QuoteRequestStatus = 'Approved';

export interface QuoteRequestSourceClaim {
  /** The Organization the Order is being placed for. */
  orderOrganizationId: string;
  /** The request the basket names, read just now — `null` when it does not exist. */
  quoteRequest: { organizationId: string; status: QuoteRequestStatus } | null;
  quoteRequestLines: ReadonlyArray<{
    productId: string;
    variantId: string | null;
    agreedUnitPrice: string | null;
  }>;
  basketLines: ReadonlyArray<{ productId: string; variantId: string | null; unitPrice: string }>;
}

export type QuoteRequestSourceRefusal =
  | 'not-found'
  | 'other-organization'
  | 'not-convertible'
  | 'no-agreed-line';

export function judgeQuoteRequestSource(
  claim: QuoteRequestSourceClaim,
): { accepted: true } | { accepted: false; reason: QuoteRequestSourceRefusal } {
  const { quoteRequest } = claim;
  if (!quoteRequest) return { accepted: false, reason: 'not-found' };
  // Constitution XI. An Order never names a document of another tenant,
  // whatever its basket says: the id would hand `crm` a link across
  // Organizations and complete a request its owner never ordered.
  if (quoteRequest.organizationId !== claim.orderOrganizationId) {
    return { accepted: false, reason: 'other-organization' };
  }
  // Cancelled, expired or already completed between the conversion and the
  // checkout: the seller's commitment is no longer there to consume.
  if (quoteRequest.status !== CONVERTIBLE_STATUS) {
    return { accepted: false, reason: 'not-convertible' };
  }
  // The Order is the request's Order while it still holds something the
  // request agreed: the same product and variant at the agreed unit price. A
  // basket whose agreed lines were all taken out and replaced from the price
  // list has nothing of the request left in it.
  const holdsAgreedLine = claim.basketLines.some((basketLine) =>
    claim.quoteRequestLines.some(
      (agreed) =>
        agreed.productId === basketLine.productId &&
        (agreed.variantId ?? null) === (basketLine.variantId ?? null) &&
        // `quote_requests` seeds a line with no agreed price at zero; the same
        // reading here, or such a line could never be recognised.
        Number(agreed.agreedUnitPrice ?? '0') === Number(basketLine.unitPrice),
    ),
  );
  return holdsAgreedLine ? { accepted: true } : { accepted: false, reason: 'no-agreed-line' };
}
