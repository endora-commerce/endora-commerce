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
  discountLabel: (code: string | null) => (code ? `Discount (${code})` : 'Discount'),
  grandTotalLabel: 'Total',
  deliveryLabel: 'Delivery',
  deliveryValue: 'calculated at checkout',
  netSuffix: 'net',
  grossSuffix: 'gross',
};

describe('CartTotals — SSR rendering', () => {
  it('renders subtotal + grand total, no discount row when discount is null', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={null}
        grandTotal={{ amount: 100, currency: 'PLN' }}
        itemCount={2}
        locale="pl-PL"
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Subtotal (2 items)');
    expect(html).toContain('Total');
    expect(html).toContain('Delivery');
    // pl-PL currency style renders the złoty symbol with an nbsp separator.
    expect(html).toMatch(/100,00\s*zł/);
    expect(html).not.toContain('Discount');
  });

  it('renders the discount row when a coupon is active', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={{ code: 'SAVE10', amount: 10, currency: 'PLN' }}
        grandTotal={{ amount: 90, currency: 'PLN' }}
        itemCount={1}
        locale="pl-PL"
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Discount (SAVE10)');
    expect(html).toContain('Subtotal (1 item)');
    // The "−" sign + amount may be split by a comment marker; match either form.
    expect(html).toMatch(/−[^<]*<!--.*?-->[^>]*10,00\s*zł|−10,00\s*zł/);
    expect(html).toMatch(/90,00\s*zł/);
  });

  it('renders gross amounts (net × 1.23) with the gross suffix in gross_only mode', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={null}
        grandTotal={{ amount: 100, currency: 'PLN' }}
        itemCount={1}
        locale="pl-PL"
        displayMode="gross_only"
        strings={STRINGS}
      />,
    );
    // 100 net → 123,00 zł gross, tagged "gross"; the net value must not appear.
    expect(html).toMatch(/123,00\s*zł/);
    expect(html).toContain('gross');
    expect(html).not.toContain('net<');
  });

  it('renders both net and gross columns in both mode', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 100, currency: 'PLN' }}
        discount={null}
        grandTotal={{ amount: 100, currency: 'PLN' }}
        itemCount={1}
        locale="pl-PL"
        displayMode="both"
        strings={STRINGS}
      />,
    );
    expect(html).toMatch(/100,00\s*zł/);
    expect(html).toMatch(/123,00\s*zł/);
    expect(html).toContain('net');
    expect(html).toContain('gross');
  });

  it('formats fractional currency with pl-PL locale', () => {
    const html = renderToString(
      <CartTotals
        subtotal={{ amount: 12.345, currency: 'EUR' }}
        discount={null}
        grandTotal={{ amount: 12.345, currency: 'EUR' }}
        itemCount={1}
        locale="pl-PL"
        strings={STRINGS}
      />,
    );
    // pl-PL uses comma as decimal separator + the € symbol: 12,35 € (rounded).
    expect(html).toMatch(/12,35\s*€/);
  });
});
