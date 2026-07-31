import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartLine, type CartLineViewModel } from '../../components/CartLine';

/**
 * Feature 027 US1 — SSR contract for CartLine.
 *
 * Server-component-friendly per-line row. The 500 ms auto-save debounce
 * on the qty input is browser-side state (not exercised here); the
 * SSR shell renders three forms so qty update / remove / save-to-list
 * all work even with JS disabled.
 */

const noopAction = async (): Promise<void> => undefined;

const STRINGS = {
  qtyLabel: 'Quantity',
  unitPriceLabel: 'Unit price',
  lineTotalLabel: 'Line total',
  removeLabel: 'Remove',
  saveToListLabel: 'Save to list',
  netSuffix: 'net',
  grossSuffix: 'gross',
  unavailable: {
    out_of_stock: 'Out of stock.',
    not_purchasable: 'No longer available.',
    no_price_in_customer_list: 'Pricing unavailable.',
  },
};

const LINE: CartLineViewModel = {
  id: 'line-1',
  productId: 'p-1',
  variantId: null,
  productName: 'Brass widget',
  quantity: 3,
  unitPrice: { amount: 12.5, currency: 'PLN' },
  lineTotal: { amount: 37.5, currency: 'PLN' },
};

describe('CartLine — SSR rendering', () => {
  it('renders the product name, quantity, unit and line totals', () => {
    const html = renderToString(
      <CartLine
        line={LINE}
        updateAction={noopAction}
        removeAction={noopAction}
        saveToListAction={noopAction}
        locale="pl-PL"
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Brass widget');
    expect(html).toContain('value="3"');
    expect(html).toMatch(/12,50\s*zł/);
    expect(html).toMatch(/37,50\s*zł/);
  });

  it('renders gross unit and line prices (net × 1.23) in gross_only mode', () => {
    const html = renderToString(
      <CartLine
        line={LINE}
        updateAction={noopAction}
        removeAction={noopAction}
        saveToListAction={noopAction}
        locale="pl-PL"
        displayMode="gross_only"
        strings={STRINGS}
      />,
    );
    // 12,50 net → `15,38 zł` gross; 37,50 net → `46,13 zł` gross (rounded).
    expect(html).toMatch(/15,38\s*zł/);
    expect(html).toMatch(/46,13\s*zł/);
    expect(html).toContain('gross');
  });

  it('renders three forms (qty / remove / save-to-list) so SSR/no-JS still works', () => {
    const html = renderToString(
      <CartLine
        line={LINE}
        updateAction={noopAction}
        removeAction={noopAction}
        saveToListAction={noopAction}
        strings={STRINGS}
      />,
    );
    // Three <form> tags rendered.
    const formCount = (html.match(/<form/g) ?? []).length;
    expect(formCount).toBe(3);
    expect(html).toContain('Save to list');
    expect(html).toContain('Remove');
  });

  it('surfaces the localised unavailable label when the line is flagged', () => {
    const html = renderToString(
      <CartLine
        line={{ ...LINE, unavailable: true, unavailableReason: 'out_of_stock' }}
        updateAction={noopAction}
        removeAction={noopAction}
        saveToListAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).toContain('Out of stock.');
  });

  it('emits no unavailable label on a healthy line', () => {
    const html = renderToString(
      <CartLine
        line={LINE}
        updateAction={noopAction}
        removeAction={noopAction}
        saveToListAction={noopAction}
        strings={STRINGS}
      />,
    );
    expect(html).not.toContain('Out of stock.');
    expect(html).not.toContain('No longer available.');
  });

  it('hidden inputs carry the itemId on every form', () => {
    const html = renderToString(
      <CartLine
        line={LINE}
        updateAction={noopAction}
        removeAction={noopAction}
        saveToListAction={noopAction}
        strings={STRINGS}
      />,
    );
    // 3 forms × 1 hidden itemId input each = 3 hidden inputs with value="line-1"
    const hiddenCount = (html.match(/type="hidden"[^>]*name="itemId"[^>]*value="line-1"/g) ?? [])
      .length;
    expect(hiddenCount).toBe(3);
  });
});
