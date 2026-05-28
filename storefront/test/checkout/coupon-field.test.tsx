import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CouponField } from '../../components/checkout/CouponField';

/**
 * Feature 036 (US3) — the checkout coupon control shows the applied discount
 * (so the buyer sees it before placing) and surfaces a reason-specific error
 * when a code is rejected.
 */
const noop = (): void => {};

describe('CouponField', () => {
  it('shows an Apply control and no discount when nothing is applied', () => {
    const html = renderToString(
      <CouponField applied={null} error={null} applyAction={noop} clearAction={noop} locale="en-US" />,
    );
    expect(html).toContain('name="couponCode"');
    expect(html).toContain('Apply');
    expect(html).not.toContain('Remove');
  });

  it('reflects the applied coupon and its discount', () => {
    const html = renderToString(
      <CouponField
        applied={{ code: 'CHECKOUT10', amount: 12.5, currency: 'PLN' }}
        error={null}
        applyAction={noop}
        clearAction={noop}
        locale="en-US"
      />,
    );
    expect(html).toContain('CHECKOUT10');
    expect(html).toContain('−12.50 PLN');
    expect(html).toContain('Remove');
  });

  it('surfaces a reason-specific rejection message', () => {
    const html = renderToString(
      <CouponField
        applied={null}
        error="This coupon has expired."
        applyAction={noop}
        clearAction={noop}
        locale="en-US"
      />,
    );
    expect(html).toContain('This coupon has expired.');
  });
});
