import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartTotals } from '../../components/CartTotals';

/**
 * Feature 027 US1 — SSR contract for CartTotals.
 */

const STRINGS = {
  subtotalLabel: 'Subtotal',
  discountLabel: (code: string) => `Discount (${code})`,
  grandTotalLabel: 'Total',
};

describe('CartTotals — SSR rendering', () => {
  it('renders subtotal + grand total, no discount block when discount is null', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={null}
        grandTotal={{ amount: 100, currency: 'PLN' }}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Subtotal');
    expect(html).toContain('Total');
    expect(html).toContain('100.00 PLN');
    expect(html).not.toContain('Discount');
  });

  it('renders the discount row when a coupon is active', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={{ code: 'SAVE10', amount: 10, currency: 'PLN' }}
        grandTotal={{ amount: 90, currency: 'PLN' }}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Discount (SAVE10)');
    // Discount amount rendered as negative. React SSR may insert a
    // comment marker between the minus sign and the amount span, so
    // assert each side independently.
    expect(html).toMatch(/−[^<]*<!--.*?-->[^>]*10\.00 PLN|−10\.00 PLN/);
    expect(html).toContain('90.00 PLN');
  });

  it('handles fractional currency formatting', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 12.345, currency: 'EUR' }}
        discount={null}
        grandTotal={{ amount: 12.345, currency: 'EUR' }}
        strings={STRINGS}
      />,
    );
    // .toFixed(2) rounds to 12.35 with banker rounding falling back to half-away.
    expect(html).toContain('12.35 EUR');
  });
});
