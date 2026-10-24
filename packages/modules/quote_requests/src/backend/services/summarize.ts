import { lineAmountHalfUp, moneySum, type QuoteRequestSummary } from '@endora-commerce/contracts';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';

/** Prices × quantities summed exactly, as a two-place number (issue #417: 3 × 9.05 was 27.150000000000002). */
export function listTotal(lines: ReadonlyArray<{ price: string; quantity: number }>): number {
  return Number(moneySum(lines.map((l) => lineAmountHalfUp(l.price, l.quantity))));
}

/**
 * The customer list's row for one quote request.
 *
 * Both totals follow one rule — **every line, or `null`** (FR-009). The
 * customer-price total exists only when every line carries a customer proposal:
 * a request with no proposal (cart-converted, raised by a locked customer) or
 * with proposals on some lines only has no customer-price total, never `0` and
 * never a partial sum, and the reference price is not a fallback for it. The
 * admin list applies the same rule; the storefront renders `null` as "—".
 */
export function summarize(
  rfq: QuoteRequest,
  items: QuoteRequestItem[],
  extras: { requesterDisplayName?: string | null; taxRate?: number },
): QuoteRequestSummary {
  const totalAtCustomerPrice =
    items.length > 0 && items.every((it) => it.desiredUnitPrice != null)
      ? listTotal(items.map((it) => ({ price: it.desiredUnitPrice!, quantity: it.quantity })))
      : null;
  const totalAtAgreedPrice = items.every((it) => it.agreedUnitPrice != null)
    ? listTotal(items.map((it) => ({ price: it.agreedUnitPrice ?? '0', quantity: it.quantity })))
    : null;
  const currency = items[0]?.lineCurrency ?? 'PLN';
  return {
    id: rfq.id,
    businessId: rfq.businessId,
    organizationId: rfq.organizationId,
    customerAccountId: rfq.customerAccountId,
    status: rfq.status,
    awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
    lineCount: items.length,
    totalAtCustomerPrice,
    totalAtAgreedPrice,
    taxRate: extras.taxRate ?? 0,
    currency,
    submittedAt: rfq.submittedAt?.toISOString() ?? null,
    expiresAt: rfq.expiresAt?.toISOString() ?? null,
    createdAt: rfq.createdAt.toISOString(),
    updatedAt: rfq.updatedAt.toISOString(),
    version: rfq.version,
    originalRequester: {
      customerAccountId: rfq.customerAccountId,
      displayName: extras.requesterDisplayName ?? null,
    },
  };
}
