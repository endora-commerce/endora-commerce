import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { COUPON_FORM_ID, CouponField, CouponScope } from '../../components/checkout/CouponField';

/**
 * Feature 036 (US3) — the checkout coupon control shows the applied discount (so the buyer sees
 * it before placing). Issue #1250 — its fields belong to the coupon's own form, and its result
 * has a status region from the first paint. What a refusal renders, and what the buttons send,
 * is `coupon-keeps-checkout-form.test.tsx`'s.
 */
const action = async () => ({ outcome: 'idle' as const, code: '', message: null });

function render(applied: Parameters<typeof CouponField>[0]['applied']): string {
  return renderToString(
    <CouponScope action={action}>
      <CouponField applied={applied} locale="en-US" />
    </CouponScope>,
  );
}

describe('CouponField', () => {
  it('shows an Apply control and no discount when nothing is applied', () => {
    const html = render(null);
    expect(html).toContain('name="couponCode"');
    expect(html).toContain('Apply');
    expect(html).not.toContain('Remove');
    expect(html).toMatch(/<p id="couponCode-status" role="status"[^>]*><\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it('reflects the applied coupon and its discount', () => {
    const html = render({ code: 'CHECKOUT10', amount: 12.5, currency: 'PLN' });
    expect(html).toContain('CHECKOUT10');
    expect(html).toContain('−12.50 PLN');
    expect(html).toContain('Remove');
  });

  it('ties the input and both buttons to the coupon form, rendered after the field', () => {
    const html = render({ code: 'CHECKOUT10', amount: 12.5, currency: 'PLN' });
    expect(html.match(new RegExp(`form="${COUPON_FORM_ID}"`, 'g'))).toHaveLength(3);
    expect(html.indexOf(`<form id="${COUPON_FORM_ID}"`)).toBeGreaterThan(
      html.indexOf('name="couponCode"'),
    );
  });
});
