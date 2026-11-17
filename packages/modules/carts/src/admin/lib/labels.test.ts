import { describe, expect, it } from 'vitest';
import { cartStateLabel } from './labels.js';

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
