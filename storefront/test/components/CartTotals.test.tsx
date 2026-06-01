import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartTotals } from '../../components/CartTotals';

/**
 * Feature 027 US1 — SSR contract for the Industria-themed CartTotals.
 *
 * The component itself emits the row list + total; the surrounding
 * `.cart-summary` card is provided by the parent page. Tests assert
 * the row contract rather than the wrapper.
 */

const STRINGS = {
  subtotalLabel: (n: number) => (n === 1 ? 'Subtotal (1 item)' : `Subtotal (${n} items)`),
  discountLabel: (code: string) => `Discount (${code})`,
  grandTotalLabel: 'Total',
  deliveryLabel: 'Delivery',
  deliveryValue: 'calculated at checkout',
};

describe('CartTotals — SSR rendering', () => {
  it('renders subtotal + grand total, no discount row when discount is null', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={null}
        grandTotal={{ amount: 100, currency: 'PLN' }}
        itemCount={2}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Subtotal (2 items)');
    expect(html).toContain('Total');
    expect(html).toContain('Delivery');
    expect(html).toContain('100,00 PLN');
    expect(html).not.toContain('Discount');
  });

  it('renders the discount row when a coupon is active', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={{ code: 'SAVE10', amount: 10, currency: 'PLN' }}
        grandTotal={{ amount: 90, currency: 'PLN' }}
        itemCount={1}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Discount (SAVE10)');
    expect(html).toContain('Subtotal (1 item)');
    // The "−" sign + amount may be split by a comment marker; match either form.
    expect(html).toMatch(/−[^<]*<!--.*?-->[^>]*10,00 PLN|−10,00 PLN/);
    expect(html).toContain('90,00 PLN');
  });

  it('formats fractional currency with pl-PL locale', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 12.345, currency: 'EUR' }}
        discount={null}
        grandTotal={{ amount: 12.345, currency: 'EUR' }}
        itemCount={1}
        strings={STRINGS}
      />,
    );
    // pl-PL uses comma as decimal separator: 12,35 EUR (rounded).
    expect(html).toContain('12,35 EUR');
  });
});
