import { describe, expect, it } from 'vitest';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { listTotal, summarize } from './summarize.js';

/**
 * Feature 146, Phase 5 (T026) — the customer list's `totalAtCustomerPrice`
 * exists only when every line carries a customer proposal (FR-009, US1 #8a–#8c),
 * the rule the admin list already applies. No partial sum, no reference-price
 * fill, never `0` for "nothing proposed".
 */

const rfq = {
  id: 'rfq-1',
  businessId: 'QR-1',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  status: 'Pending',
  awaitingCustomerRevisionAcceptance: false,
  submittedAt: new Date('2026-10-14T10:00:00Z'),
  expiresAt: null,
  createdAt: new Date('2026-10-14T10:00:00Z'),
  updatedAt: new Date('2026-10-14T10:00:00Z'),
  version: 1,
} as unknown as QuoteRequest;

const item = (quantity: number, desiredUnitPrice: string | null, extra: Record<string, unknown> = {}) =>
  ({
    quantity,
    desiredUnitPrice,
    agreedUnitPrice: null,
    lineCurrency: 'PLN',
    referenceUnitPrice: '120.00',
    referenceCurrency: 'PLN',
    ...extra,
  }) as unknown as QuoteRequestItem;

describe('summarize — totalAtCustomerPrice (FR-009)', () => {
  it('is null when no line carries a proposal (US1 #8a — a cart-converted request)', () => {
    expect(summarize(rfq, [item(2, null), item(1, null)], {}).totalAtCustomerPrice).toBeNull();
  });

  it('is null when only some lines carry a proposal (US1 #8b — no partial sum, no reference fill)', () => {
    expect(summarize(rfq, [item(2, '100.00'), item(1, null)], {}).totalAtCustomerPrice).toBeNull();
  });

  it('is the sum when every line carries a proposal (US1 #8c — 2 × 100 + 1 × 50 = 250)', () => {
    expect(summarize(rfq, [item(2, '100.00'), item(1, '50.00')], {}).totalAtCustomerPrice).toBe(250);
  });

  it('counts a proposal of exactly zero as a proposal', () => {
    expect(summarize(rfq, [item(3, '0.00')], {}).totalAtCustomerPrice).toBe(0);
  });

  it('is null for a request with no lines', () => {
    expect(summarize(rfq, [], {}).totalAtCustomerPrice).toBeNull();
  });

  it('keeps the agreed-price total on its own all-lines-or-null rule', () => {
    const priced = [
      item(2, null, { agreedUnitPrice: '90.00' }),
      item(1, null, { agreedUnitPrice: '40.00' }),
    ];
    const summary = summarize(rfq, priced, { taxRate: 0.23, requesterDisplayName: 'Jan' });
    expect(summary.totalAtAgreedPrice).toBe(220);
    expect(summary.totalAtCustomerPrice).toBeNull();
    expect(summary.taxRate).toBe(0.23);
    expect(summary.originalRequester).toEqual({ customerAccountId: 'acc-1', displayName: 'Jan' });
    expect(summary.lineCount).toBe(2);
  });
});

describe('summarize — exact totals (#417 review)', () => {
  it('publishes 3 × 9.05 as 27.15, not the binary 27.150000000000002', () => {
    const s = summarize(rfq, [item(3, '9.05', { agreedUnitPrice: '9.05' })], {});
    expect(s.totalAtCustomerPrice).toBe(27.15);
    expect(s.totalAtAgreedPrice).toBe(27.15);
  });
});

describe('listTotal (#417 review)', () => {
  it('sums prices × quantities exactly — the customer and the admin list share it', () => {
    expect(listTotal([{ price: '9.05', quantity: 3 }])).toBe(27.15);
    expect(listTotal([{ price: '0.10', quantity: 1 }, { price: '0.20', quantity: 1 }])).toBe(0.3);
  });
});
