import { describe, expect, it } from 'vitest';
import type { ReturnableResponse } from '../../lib/api/returns';
import { filedByColleague, mayStartReturn, orderReturnAction } from '../../lib/returns/returnForm';

/**
 * Feature 155, FR-021 / FR-018 — the order detail page offers the action the order's
 * returnability allows: a return (with complaints) when any line is returnable, a complaint
 * only when none is (`no_returnable_lines`), nothing otherwise. Until this feature the page
 * read `eligible` alone and hid the entry for an order whose products are all non-returnable,
 * though a complaint about it is still accepted.
 */
function answer(input: Partial<ReturnableResponse>): ReturnableResponse {
  return { eligible: false, freeReturnEligible: false, lines: [], ...input };
}

describe('orderReturnAction', () => {
  it.each([
    ['en-US', 'Request return / complaint'],
    ['pl-PL', 'Zgłoś zwrot / reklamację'],
  ])('is a return when the order is eligible (%s)', (locale, label) => {
    const action = orderReturnAction(answer({ eligible: true }), 'order-1', locale, true);
    expect(action).toEqual({
      kind: 'return',
      label,
      href: '/returns/new?orderId=order-1',
    });
  });

  it.each([
    ['en-US', 'File a complaint'],
    ['pl-PL', 'Złóż reklamację'],
  ])('is a complaint for no_returnable_lines (%s)', (locale, label) => {
    const action = orderReturnAction(answer({ reason: 'no_returnable_lines' }), 'order-1', locale, true);
    expect(action).toEqual({
      kind: 'complaint',
      label,
      href: '/returns/new?orderId=order-1&kind=complaint',
    });
  });

  it.each(['order_not_completing', 'fully_returned', 'window_passed'] as const)(
    'is null for %s',
    (reason) => {
      expect(orderReturnAction(answer({ reason }), 'order-1', 'en-US', true)).toBeNull();
    },
  );

  it('is null for an ineligible answer without a reason', () => {
    expect(orderReturnAction(answer({}), 'order-1', 'en-US', true)).toBeNull();
  });

  it('encodes the order id in the link', () => {
    expect(orderReturnAction(answer({ eligible: true }), 'a b', 'en-US', true)?.href).toBe(
      '/returns/new?orderId=a%20b',
    );
  });
});

/**
 * Feature 170 (`specs/170-organization-roles/`, FR-052, FR-057, owner ruling OR-11) — opening a
 * return or a complaint needs `returns.create`. The order detail offers neither entry to a member
 * whose role lacks it (a single action: hidden, not explained), whatever the order allows.
 */
describe('orderReturnAction — by permission (FR-052, FR-057)', () => {
  it.each([
    ['an eligible order', answer({ eligible: true })],
    ['a complaint-only order', answer({ reason: 'no_returnable_lines' })],
  ])('is null for %s when the member may not open one', (_label, returnable) => {
    expect(orderReturnAction(returnable, 'order-1', 'en-US', false)).toBeNull();
  });
});

describe('mayStartReturn', () => {
  it('follows returns.create for a member', () => {
    expect(mayStartReturn({ permissions: ['returns.create'] })).toBe(true);
    expect(mayStartReturn({ permissions: ['orders.view_organization', 'returns.view_organization'] })).toBe(false);
    expect(mayStartReturn({ permissions: [] })).toBe(false);
  });

  it('keeps today\'s page when the session could not be read (the server judges)', () => {
    expect(mayStartReturn(null)).toBe(true);
  });
});

describe('filedByColleague (FR-053, Q-R2 = A)', () => {
  it('is true only when both ids are known and differ', () => {
    expect(filedByColleague('member-2', 'member-1')).toBe(true);
    expect(filedByColleague('member-1', 'member-1')).toBe(false);
    expect(filedByColleague(undefined, 'member-1')).toBe(false);
    expect(filedByColleague('member-2', undefined)).toBe(false);
  });
});
