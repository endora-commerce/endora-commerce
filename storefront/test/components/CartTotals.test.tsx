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

/**
 * Issue #436 — a cart at 23 % (29,50 + 16,50), 8 % (2 × 8,25), 5 % (800 × 0,0125)
 * and 0 % (12,00), with a 5,00 discount, as `GET /api/v1/cart` answers it.
 */
const MIXED = {
  subtotal: { amount: 84.5, currency: 'PLN' },
  discount: { code: 'SAVE5', amount: 5, currency: 'PLN' },
  grandTotal: { amount: 79.5, currency: 'PLN' },
  vat: {
    currency: 'PLN',
    rows: [
      { taxRate: 0, net: 12, vat: 0, gross: 12 },
      { taxRate: 0.05, net: 10, vat: 0.5, gross: 10.5 },
      { taxRate: 0.08, net: 16.5, vat: 1.32, gross: 17.82 },
      { taxRate: 0.23, net: 46, vat: 10.58, gross: 56.58 },
    ],
    vatTotal: 12.4,
    subtotalGross: 96.9,
    grandTotalGross: 91.9,
  },
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
    // pl-PL currency style renders the PLN symbol `zł` with an nbsp separator.
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

  // Issue #436 — the backend's VAT per rate, not net × a flat 23 %.
  it('renders the gross totals the cart read answers for a mixed-rate cart in gross_only mode', () => {
    const html = renderToString(
      <CartTotals
        subtotal={MIXED.subtotal}
        discount={MIXED.discount}
        grandTotal={MIXED.grandTotal}
        vat={MIXED.vat}
        itemCount={5}
        locale="pl-PL"
        displayMode="gross_only"
        strings={STRINGS}
      />,
    );
    expect(html).toMatch(/96,90\s*zł/);
    expect(html).toMatch(/91,90\s*zł/);
    // The discount comes off the gross untaxed, as it does on the order.
    expect(html).toMatch(/5,00\s*zł/);
    expect(html).toContain('gross');
    expect(html).not.toContain('net<');
    // The flat 23 %: 84,50 → 103,94 and 79,50 → 97,79.
    expect(html).not.toMatch(/103,94\s*zł/);
    expect(html).not.toMatch(/97,79\s*zł/);
  });

  it('renders net and the per-rate gross side by side in both mode', () => {
    const html = renderToString(
      <CartTotals
        subtotal={MIXED.subtotal}
        discount={MIXED.discount}
        grandTotal={MIXED.grandTotal}
        vat={MIXED.vat}
        itemCount={5}
        locale="pl-PL"
        displayMode="both"
        strings={STRINGS}
      />,
    );
    expect(html).toMatch(/84,50\s*zł/);
    expect(html).toMatch(/96,90\s*zł/);
    expect(html).toMatch(/79,50\s*zł/);
    expect(html).toMatch(/91,90\s*zł/);
    expect(html).toContain('net');
    expect(html).toContain('gross');
  });

  it('renders the net, tagged net, when the cart read carries no VAT — no invented gross', () => {
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
    expect(html).toMatch(/100,00\s*zł/);
    expect(html).not.toMatch(/123,00\s*zł/);
    expect(html).not.toContain('gross');
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
