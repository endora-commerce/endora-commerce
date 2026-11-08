import type { OpportunityExcludedDocument } from '@endora-commerce/contracts';

/**
 * The computed value of an Opportunity — pure, and exact
 * (`specs/143-crm-sales-opportunities/research.md` R-14).
 *
 * A linked document counts when its status is in the configured counting set
 * of its kind and it is in the Opportunity's currency. Money arrives as decimal
 * strings (`numeric(14,2)` everywhere) and is added as integers, so `0.10 +
 * 0.20` is `0.30`.
 */

/** A linked Order, as `orders`' read port publishes it. */
export interface ValueOrderDocument {
  id: string;
  status: string;
  /** The Order's published total — a decimal string. */
  total: string;
  currency: string;
  /** The Quote Request this Order was placed from, when `orders` recorded one. */
  sourceQuoteRequestId?: string | null;
}

/**
 * A linked Quote Request, at the amount `quote_requests` publishes for it
 * (`quoteRequestReadPort.amountOf`, issue #456) — this module does not value
 * the lines itself.
 */
export interface ValueQuoteRequestDocument {
  id: string;
  status: string;
  /** The Order placed from this Quote Request, once there is one. */
  convertedOrderId: string | null;
  /** Two places, net of tax; `null` when no line has a price — it adds nothing. */
  amount: string | null;
  /** The amount's currency; `null` for a Quote Request without a line. */
  currency: string | null;
}

export interface OpportunityValueInput {
  /** The Opportunity's currency; a document in another one is left out and named. */
  currency: string;
  countingStatuses: { order: readonly string[]; quoteRequest: readonly string[] };
  orders: readonly ValueOrderDocument[];
  quoteRequests: readonly ValueQuoteRequestDocument[];
}

export interface OpportunityValueResult {
  /** Two decimal places, as the column reads back. */
  value: string;
  /** Documents that would have counted and were left out, in the order given. */
  excludedDocuments: OpportunityExcludedDocument[];
}

/** Why a document that would have counted was left out. */
export const VALUE_EXCLUSION_CURRENCY_MISMATCH = 'currency_mismatch';

/**
 * Fractional digits kept while adding. Every figure here arrives at two
 * places; the scale is what the parser reads, not a precision anything needs.
 */
const SCALE_DIGITS = 6;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const CENT = SCALE / 100n;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * A non-negative decimal string as a scaled integer, or `null` for anything
 * else. Places beyond the scale are dropped: no money column in the tree
 * carries that many.
 */
function parseDecimal(value: string): bigint | null {
  const match = DECIMAL.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? '').slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0');
  return BigInt(match[1] as string) * SCALE + BigInt(fraction);
}

/** Round half up to two places and render as `123.45`. */
function formatScaled(scaled: bigint): string {
  const cents = (scaled + CENT / 2n) / CENT;
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

export function calculateOpportunityValue(input: OpportunityValueInput): OpportunityValueResult {
  const countingOrders = new Set(input.countingStatuses.order);
  const countingQuoteRequests = new Set(input.countingStatuses.quoteRequest);
  const excludedDocuments: OpportunityExcludedDocument[] = [];
  /** Orders that were added to the sum — what "counted once" is decided against. */
  const countedOrderIds = new Set<string>();
  /** The Quote Requests those Orders were placed from, as the Orders themselves say. */
  const countedThroughOrder = new Set<string>();
  let total = 0n;

  for (const order of input.orders) {
    if (!countingOrders.has(order.status)) continue;
    if (order.currency !== input.currency) {
      excludedDocuments.push({ kind: 'order', id: order.id, reason: VALUE_EXCLUSION_CURRENCY_MISMATCH });
      continue;
    }
    total += parseDecimal(order.total) ?? 0n;
    countedOrderIds.add(order.id);
    if (order.sourceQuoteRequestId) countedThroughOrder.add(order.sourceQuoteRequestId);
  }

  for (const quoteRequest of input.quoteRequests) {
    if (!countingQuoteRequests.has(quoteRequest.status)) continue;
    // The same business, already counted through the Order placed from it.
    // Either side may say so: the Quote Request learns of its Order from a
    // subscriber of its own, which may not have run yet when this is asked.
    if (quoteRequest.convertedOrderId !== null && countedOrderIds.has(quoteRequest.convertedOrderId)) continue;
    if (countedThroughOrder.has(quoteRequest.id)) continue;
    // No price, or no line: it is worth nothing, and nothing was left out.
    if (quoteRequest.amount === null || quoteRequest.currency === null) continue;
    if (quoteRequest.currency !== input.currency) {
      excludedDocuments.push({
        kind: 'quote_request',
        id: quoteRequest.id,
        reason: VALUE_EXCLUSION_CURRENCY_MISMATCH,
      });
      continue;
    }
    total += parseDecimal(quoteRequest.amount) ?? 0n;
  }

  return { value: formatScaled(total), excludedDocuments };
}
