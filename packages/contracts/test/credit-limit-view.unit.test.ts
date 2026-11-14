import { describe, expect, it } from 'vitest';
import { creditLimitViewSchema } from '../src/credit-limits.js';

/**
 * Issue #661 — a credit-limit reservation carries its order's customer-facing
 * number, so the storefront widget never shows the database id. The field is
 * additive: a view without it still parses.
 */

const base = {
  organizationId: '00000000-0000-4000-8000-0000000000aa',
  grantedAmount: 1000,
  availableAmount: 400,
  currency: 'PLN',
  activeReservationCount: 1,
  grantedAt: '2026-10-01T00:00:00.000Z',
};

const reservation = {
  orderId: '00000000-0000-4000-8000-0000000000c1',
  amount: 600,
  createdAt: '2026-10-02T00:00:00.000Z',
};

describe('creditLimitViewSchema — the reservation order number (issue #661)', () => {
  it('keeps the order business id on a reservation', () => {
    const parsed = creditLimitViewSchema.parse({
      ...base,
      activeReservations: [{ ...reservation, orderBusinessId: 'ORD-2001-2026' }],
    });
    expect(parsed.activeReservations[0]?.orderBusinessId).toBe('ORD-2001-2026');
  });

  it('accepts a null number and a reservation that predates the field', () => {
    expect(
      creditLimitViewSchema.parse({ ...base, activeReservations: [{ ...reservation, orderBusinessId: null }] })
        .activeReservations[0]?.orderBusinessId,
    ).toBeNull();
    expect(
      creditLimitViewSchema.parse({ ...base, activeReservations: [reservation] }).activeReservations[0],
    ).not.toHaveProperty('orderBusinessId');
  });
});
