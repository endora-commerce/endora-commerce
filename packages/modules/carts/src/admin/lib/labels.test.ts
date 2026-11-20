import { describe, expect, it } from 'vitest';
import { cartRejectedByLabel, cartStateLabel } from './labels.js';

/**
 * Issues #1434, #1476 — the carts admin's enum labels. That every declared
 * value has a key in both shipped bundles is held by
 * `admin/test/modules/carts/cart-detail-labels.test.tsx`.
 */
const echo = (key: string): string => key;

describe('cart transition state labels', () => {
  it('labels a state from whichever vocabulary holds it', () => {
    expect(cartStateLabel(echo, 'abandoned')).toBe('carts.status.abandoned');
    expect(cartStateLabel(echo, 'pending')).toBe('carts.approvalStatus.pending');
    expect(cartStateLabel(echo, 'rejected_by_org_admin')).toBe('carts.approvalStatus.rejected_by_org_admin');
    expect(cartStateLabel(echo, null)).toBe('—');
  });
});

/** Issue #1548 — `rejectedByActor` is `<role>:<id>`; the screen names the role, never the id. */
describe('cart rejected-by label', () => {
  it('names the role that rejected the cart', () => {
    expect(cartRejectedByLabel(echo, 'admin:00000000-0000-4000-8000-0000000000d1')).toBe('carts.audit.actor.platform_admin');
    expect(cartRejectedByLabel(echo, 'org_admin:00000000-0000-4000-8000-0000000000d2')).toBe('carts.audit.actor.org_admin');
  });

  it('says nothing for an actor it cannot name', () => {
    expect(cartRejectedByLabel(echo, null)).toBeNull();
    expect(cartRejectedByLabel(echo, '')).toBeNull();
    expect(cartRejectedByLabel(echo, 'admin@example.com')).toBeNull();
    expect(cartRejectedByLabel(echo, 'robot:1')).toBeNull();
  });
});
