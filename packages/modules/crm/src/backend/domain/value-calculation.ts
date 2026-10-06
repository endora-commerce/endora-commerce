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

/** One line of a linked Quote Request. */
export interface ValueQuoteRequestLine {
  quantity: number;
  /** The price the line is valued at, or `null` when it carries none. */
  unitPrice: string | null;
  currency: string;
}

export interface ValueQuoteRequestDocument {
  id: string;
  status: string;
  /** The Order placed from this Quote Request, once there is one. */
  convertedOrderId: string | null;
  lines: readonly ValueQuoteRequestLine[];
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
 * Fractional digits kept while adding. A unit price may carry more places than
 * a total does; the sum is rounded to two once, at the end.
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

function sumLines(lines: readonly ValueQuoteRequestLine[]): bigint {
  let total = 0n;
  for (const line of lines) {
    if (line.unitPrice === null) continue;
    const price = parseDecimal(line.unitPrice);
    if (price === null || !Number.isInteger(line.quantity) || line.quantity <= 0) continue;
    total += price * BigInt(line.quantity);
  }
  return total;
}

/**
 * What a Quote Request is worth: the sum of `quantity × unit price` over its
 * lines — the quote desk's own arithmetic, done exactly. A line without a
 * price adds nothing.
 */
export function quoteRequestAmount(lines: readonly ValueQuoteRequestLine[]): string {
  return formatScaled(sumLines(lines));
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
    const matching = quoteRequest.lines.filter((line) => line.currency === input.currency);
    if (matching.length !== quoteRequest.lines.length) {
      excludedDocuments.push({
        kind: 'quote_request',
        id: quoteRequest.id,
        reason: VALUE_EXCLUSION_CURRENCY_MISMATCH,
      });
    }
    total += sumLines(matching);
  }

  return { value: formatScaled(total), excludedDocuments };
}
