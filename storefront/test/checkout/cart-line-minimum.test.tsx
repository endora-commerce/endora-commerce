import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartLine, type CartLineViewModel } from '../../components/CartLine';
import {
  belowMinimumText,
  cartBlocksCheckout,
  cartLineDisplayName,
  cartLineEditError,
  cartLineEditErrorHref,
  cartLineFloor,
  parseCartQuantityEdit,
} from '../../lib/cartMinimum';

/**
 * Feature 155, T119 — the cart line below a minimum (US1 #4, #5; FR-013) and the line whose
 * product record is gone (FR-037). SSR-only: the markup is the assertion.
 */

const noop = async (): Promise<void> => undefined;

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
    no_price_in_customer_list: 'Pricing unavailable for your account.',
  },
};

function line(overrides: Partial<CartLineViewModel> = {}): CartLineViewModel {
  return {
    id: 'item-1',
    productId: 'prod-1',
    variantId: null,
    quantity: 3,
    unitPrice: { amount: 2, currency: 'PLN' },
    lineTotal: { amount: 6, currency: 'PLN' },
    productName: 'Anchor bolt M8',
    ...overrides,
  };
}

function render(model: CartLineViewModel, locale = 'en-US'): string {
  return renderToString(
    <CartLine
      line={model}
      updateAction={noop}
      removeAction={noop}
      saveToListAction={noop}
      locale={locale}
      strings={STRINGS}
    />,
  );
}

describe('belowMinimumText', () => {
  it('states the pieces minimum (EN and PL)', () => {
    const below = { belowMinimum: { kind: 'pieces' as const, minimum: 10 } };
    expect(belowMinimumText(below, 'en-US')).toBe('Below the minimum (10 pcs)');
    expect(belowMinimumText(below, 'pl-PL')).toBe('Poniżej minimum (10 szt.)');
  });

  it('states the packaging-unit minimum with the unit name (EN and PL)', () => {
    const below = { belowMinimum: { kind: 'packaging_unit' as const, minimum: 2, packagingUnitName: 'Pallet' } };
    expect(belowMinimumText(below, 'en-US')).toBe('Below the minimum (2 × Pallet)');
    expect(belowMinimumText(below, 'pl-PL')).toBe('Poniżej minimum (2 × Pallet)');
  });

  it('never reads a brace in the unit name as a placeholder', () => {
    const below = { belowMinimum: { kind: 'packaging_unit' as const, minimum: 2, packagingUnitName: 'Box {units}' } };
    expect(belowMinimumText(below, 'en-US')).toBe('Below the minimum (2 × Box {units})');
  });

  it('is null for a line that is not below a minimum', () => {
    expect(belowMinimumText({ belowMinimum: null }, 'en-US')).toBeNull();
    expect(belowMinimumText({}, 'en-US')).toBeNull();
  });
});

describe('cartLineFloor', () => {
  it('is the pieces minimum for a line below it', () => {
    expect(cartLineFloor({ quantity: 3, minOrderQuantity: 10, belowMinimum: { kind: 'pieces', minimum: 10 } })).toBe(10);
  });

  it('is the pieces minimum for a line at or above it', () => {
    expect(cartLineFloor({ quantity: 12, minOrderQuantity: 10, belowMinimum: null })).toBe(10);
  });

  it('never rises above the quantity of a line the server does not flag (a quote-exempt line, FR-028)', () => {
    expect(cartLineFloor({ quantity: 5, minOrderQuantity: 10, belowMinimum: null })).toBe(5);
  });

  it('is 1 without a minimum', () => {
    expect(cartLineFloor({ quantity: 3 })).toBe(1);
    expect(cartLineFloor({ quantity: 3, minOrderQuantity: null, belowMinimum: null })).toBe(1);
  });
});

describe('CartLine below the minimum', () => {
  const below = line({ minOrderQuantity: 10, belowMinimum: { kind: 'pieces', minimum: 10 } });

  it('says so beside the line and floors the input at the minimum (US1 #4)', () => {
    const html = render(below);
    expect(html).toContain('Below the minimum (10 pcs)');
    expect(html).toMatch(/<input[^>]*type="number"[^>]*min="10"/);
  });

  it('offers a one-step fix to the minimum, exempt from native validation', () => {
    const html = render(below);
    const button = html.match(/<button([^>]*)>Set to 10 pcs<\/button>/);
    expect(button).not.toBeNull();
    expect(button?.[1]).toContain('name="quantity"');
    expect(button?.[1]).toContain('value="10"');
    expect(button?.[1]).toContain('formNoValidate=""');
  });

  it('steps "+" straight to the minimum, posted apart from the input so it is the value read', () => {
    const plus = render(below).match(/<button([^>]*aria-label="\+"[^>]*)>/);
    expect(plus?.[1]).toContain('name="step"');
    expect(plus?.[1]).toContain('value="10"');
    expect(plus?.[1]).toContain('formNoValidate=""');
  });

  it('states the pallet variant (US1 #5)', () => {
    const html = render(
      line({ quantity: 64, belowMinimum: { kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' } }),
    );
    expect(html).toContain('Below the minimum (2 × Pallet)');
  });

  it('renders in Polish', () => {
    expect(render(below, 'pl-PL')).toContain('Poniżej minimum (10 szt.)');
  });

  it('keeps an unflagged line free of the warning, and a quote-exempt line editable at its quantity', () => {
    const html = render(line({ quantity: 5, minOrderQuantity: 10, belowMinimum: null }));
    expect(html).not.toContain('Below the minimum');
    expect(html).toMatch(/<input[^>]*type="number"[^>]*min="5"/);
  });
});

describe('CartLine whose product is gone (FR-037)', () => {
  const gone = line({
    productName: cartLineDisplayName({ productId: 'prod-1' }, 'en-US'),
    unavailable: true,
    unavailableReason: 'not_purchasable',
    belowMinimum: null,
  });

  it('renders "no longer available" with remove only', () => {
    const html = render(gone);
    expect(html).toContain('No longer available.');
    expect(html).toContain('aria-label="Remove"');
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('Save to list');
  });

  it('never shows a raw id as the line name', () => {
    expect(cartLineDisplayName({ productId: 'prod-1' }, 'en-US')).not.toContain('prod-1');
    expect(render(gone)).not.toContain('>prod-1<');
  });
});

describe('cartBlocksCheckout', () => {
  it('is true for a line whose product is gone', () => {
    expect(cartBlocksCheckout({ items: [{ unavailable: true, unavailableReason: 'not_purchasable' }] })).toBe(true);
  });

  it('is true for a line below a minimum', () => {
    expect(cartBlocksCheckout({ items: [{ belowMinimum: { kind: 'pieces', minimum: 10 } }] })).toBe(true);
  });

  it('is false for a cart of ordinary lines', () => {
    expect(cartBlocksCheckout({ items: [{ unavailable: false, belowMinimum: null }, {}] })).toBe(false);
  });
});

/**
 * Round B UI review — pressing Enter in the quantity input submits the form's
 * default button, the first submit button in tree order. That was "−", which
 * posts `step` instead of the typed quantity and is disabled at the floor, so
 * Enter either stepped down or did nothing. A visually hidden submit with no
 * `name` now comes first, so Enter posts the typed `quantity`.
 */
describe('CartLine — Enter in the quantity input applies the typed quantity', () => {
  function quantityForm(markup: string): string {
    const start = markup.lastIndexOf('<form', markup.indexOf('name="quantity"'));
    return markup.slice(start, markup.indexOf('</form>', start));
  }

  it('the first button of the quantity form is a nameless, visually hidden submit', () => {
    for (const quantity of [3, 10]) {
      const form = quantityForm(render(line({ quantity, minOrderQuantity: 10 })));
      const first = /<button\b[^>]*>/.exec(form)?.[0] ?? '';
      expect(first).toContain('type="submit"');
      expect(first).not.toContain('name=');
      expect(first).not.toContain('disabled');
      expect(first).toContain('sr-only');
      expect(first).toContain('tabindex="-1"');
      // It precedes the steppers.
      expect(form.indexOf(first)).toBeLessThan(form.indexOf('name="step"'));
    }
  });
});

/**
 * U4 (owner's manual test, step 4) — the browser's own `min` validation bubble spoke the
 * browser's language, not the storefront's, and refused 0, which removes the line (FR-007).
 * The stepper form no longer asks the browser to validate; the buyer reads our sentence.
 */
describe('parseCartQuantityEdit', () => {
  it('reads 0 as removing the line (FR-007)', () => {
    expect(parseCartQuantityEdit({ quantity: '0' })).toEqual({ kind: 'remove' });
    expect(parseCartQuantityEdit({ quantity: ' 0 ' })).toEqual({ kind: 'remove' });
  });

  it('reads a whole number as the new quantity, a stepper step first', () => {
    expect(parseCartQuantityEdit({ quantity: '4' })).toEqual({ kind: 'set', quantity: 4 });
    expect(parseCartQuantityEdit({ step: '11', quantity: '4' })).toEqual({ kind: 'set', quantity: 11 });
  });

  it('never reads an empty or garbled field as 0 — clearing the field must not delete the line', () => {
    for (const quantity of ['', '   ', 'abc', '-1', '2.5', null]) {
      expect(parseCartQuantityEdit({ quantity })).toEqual({ kind: 'invalid' });
    }
    expect(parseCartQuantityEdit({})).toEqual({ kind: 'invalid' });
  });
});

describe('cartLineEditErrorHref / cartLineEditError', () => {
  // Issue #745 — the URL carries a code (and a minimum's digits), never a sentence.
  it('round-trips the line, the code, the minimum and the typed quantity through the query', () => {
    const href = cartLineEditErrorHref('item-1', 'PRODUCT_BELOW_MINIMUM_QUANTITY', '4', 10);
    expect(href).not.toContain('Bolts');
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(cartLineEditError(params, { id: 'item-1' }, 'en-US')).toEqual({
      message: 'Below the minimum (10 pcs)',
      typed: '4',
    });
    expect(cartLineEditError(params, { id: 'item-2' }, 'en-US')).toBeNull();
  });

  it('carries no typed value when there was none', () => {
    const params = Object.fromEntries(new URL(cartLineEditErrorHref('item-1', 'UPDATE_FAILED', null), 'http://x').searchParams);
    expect(cartLineEditError(params, { id: 'item-1' }, 'en-US')).toEqual({
      message: 'Could not update the quantity. Please try again.',
      typed: null,
    });
  });
});

describe('CartLine — our own quantity messages, never the browser bubble', () => {
  function stepperForm(markup: string): string {
    const start = markup.lastIndexOf('<form', markup.indexOf('name="step"'));
    return markup.slice(start, markup.indexOf('</form>', start) + 7);
  }

  it('asks the browser not to validate the stepper form', () => {
    expect(stepperForm(render(line({ quantity: 10, minOrderQuantity: 10 })))).toMatch(/^<form[^>]*noValidate=""/);
  });

  it('explains a disabled "−" at the floor with a visible minimum hint (EN and PL)', () => {
    for (const [locale, hint] of [
      ['en-US', 'Minimum 10 pcs'],
      ['pl-PL', 'Minimum 10 szt.'],
    ] as const) {
      const html = render(line({ quantity: 10, minOrderQuantity: 10 }), locale);
      const minus = html.match(/<button([^>]*aria-label="−"[^>]*)>/)?.[1] ?? '';
      expect(minus).toContain('disabled');
      expect(minus).toContain('aria-describedby="cart-line-item-1-floor"');
      expect(html).toMatch(new RegExp(`<p[^>]*id="cart-line-item-1-floor"[^>]*>${hint}</p>`));
    }
  });

  it('shows no minimum hint for a product without one', () => {
    const html = render(line({ quantity: 1, minOrderQuantity: null }));
    expect(html).not.toContain('cart-line-item-1-floor');
  });

  it('mounts an empty polite live region for the quantity message before there is one', () => {
    const html = render(line({ quantity: 10, minOrderQuantity: 10 }));
    expect(html).toMatch(/<p[^>]*id="cart-line-item-1-qty-error"[^>]*role="status"[^>]*><\/p>/);
  });

  it('shows the refused edit beside the field, links it, and keeps the typed value', () => {
    const sentence = '"Bolts 0001" has a minimum order quantity of 10 pcs.';
    const html = renderToString(
      <CartLine
        line={line({ quantity: 10, minOrderQuantity: 10 })}
        updateAction={noop}
        removeAction={noop}
        saveToListAction={noop}
        locale="en-US"
        strings={STRINGS}
        editError={{ message: sentence, typed: '4' }}
      />,
    );
    expect(html).toMatch(/<p[^>]*id="cart-line-item-1-qty-error"[^>]*role="status"[^>]*>&quot;Bolts 0001&quot; has a minimum/);
    const input = html.match(/<input([^>]*name="quantity"[^>]*)>/)?.[1] ?? '';
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('cart-line-item-1-qty-error');
    expect(input).toContain('value="4"');
  });
});
