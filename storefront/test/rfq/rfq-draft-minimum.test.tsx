import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { DraftLine, strings } from '../../components/rfq/RfqDraftView';
import { AddToRfqButton } from '../../components/rfq/AddToRfqButton';
import {
  addToRfqDraft,
  clampDraftQuantity,
  draftQuantityFloor,
  draftQuantityOnBlur,
  draftQuantityOnType,
  type RfqDraftItem,
} from '../../lib/rfqDraft';
import { quoteAddQuantity } from '../../lib/orderMinimum';

/**
 * Feature 155, FR-032 (US4 #13, #14) — the storefront quote-request draft mirrors the cart
 * for the pieces minimum.
 *
 * `RfqDraftView` reads its lines from `localStorage` in an effect, so a server render of the
 * whole view shows an empty draft and would pass vacuously (146 T078). The units the minimum
 * reaches are tested on their own: the line, the quantity clamp, the pure add, and the
 * quantity every "add to quote" starts at.
 */
const line: RfqDraftItem = {
  productId: 'prod-1',
  slug: 'widget',
  name: 'Widget',
  unitPrice: { amount: 12, currency: 'PLN' },
  proposedUnitPrice: null,
  quantity: 3,
};

function renderLine(input: {
  quantity: number;
  minimum: number | null;
  locale: string;
}): string {
  return renderToString(
    <DraftLine
      line={{ ...line, quantity: input.quantity }}
      t={strings(input.locale)}
      locale={input.locale}
      minimum={input.minimum}
      proposalsAllowed
      onQty={(): void => undefined}
      onProposedPrice={(): void => undefined}
      onRemove={(): void => undefined}
    />,
  );
}

/** The quantity input of the line, found by its accessible name (the price input is a number too). */
function qtyInput(html: string, label: string): string {
  const match = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`));
  expect(match, `quantity input "${label}"`).not.toBeNull();
  return match![0];
}

describe('DraftLine — a line below the minimum (US4 #14)', () => {
  it.each([
    ['en-US', 'Quantity', 'Below the minimum (10 pcs)', 'Set to 10 pcs', 'Remove'],
    ['pl-PL', 'Ilość', 'Poniżej minimum (10 szt.)', 'Ustaw 10 szt.', 'Usuń'],
  ])('is shown as such, with the minimum, and can still be removed (%s)', (locale, qty, below, fix, remove) => {
    const html = renderLine({ quantity: 3, minimum: 10, locale });
    const input = qtyInput(html, qty);
    expect(input).toContain('min="10"');
    expect(input).toContain('value="3"');
    expect(input).toContain('aria-invalid="true"');
    expect(html).toContain(below);
    expect(html).toContain(fix);
    expect(html).toContain(`aria-label="${remove}"`);
  });

  it('links the warning to the quantity input', () => {
    const html = renderLine({ quantity: 3, minimum: 10, locale: 'en-US' });
    const describedBy = qtyInput(html, 'Quantity').match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
  });
});

describe('DraftLine — a line at or above the minimum (US4 #14)', () => {
  it('floors the input at the minimum and offers no step below it', () => {
    const html = renderLine({ quantity: 10, minimum: 10, locale: 'en-US' });
    const input = qtyInput(html, 'Quantity');
    expect(input).toContain('min="10"');
    expect(input).not.toContain('aria-invalid');
    expect(html).not.toContain('Below the minimum');
    // The "−" step is disabled at the floor.
    const minus = html.match(/<button[^>]*aria-label="−"[^>]*>/)?.[0] ?? '';
    expect(minus).toContain('disabled=""');
    // The minimum is still stated beside the line.
    expect(html).toContain('Minimum order: 10 pcs');
  });

  it('is unchanged without a minimum', () => {
    const html = renderLine({ quantity: 3, minimum: null, locale: 'en-US' });
    expect(qtyInput(html, 'Quantity')).toContain('min="1"');
    expect(html).not.toContain('Below the minimum');
    expect(html).not.toContain('Minimum order');
  });
});

describe('clampDraftQuantity', () => {
  it('never goes below the minimum', () => {
    expect(clampDraftQuantity(9, 10)).toBe(10);
    expect(clampDraftQuantity(2, 10)).toBe(10);
    expect(clampDraftQuantity(15, 10)).toBe(15);
  });

  it('floors at 1 without a minimum and normalises what was typed', () => {
    expect(clampDraftQuantity(0, null)).toBe(1);
    expect(clampDraftQuantity(4.7, null)).toBe(4);
    expect(clampDraftQuantity(Number.NaN, 10)).toBe(10);
    expect(clampDraftQuantity(Number.NaN, null)).toBe(1);
  });
});

describe('addToRfqDraft (pure)', () => {
  const item = { productId: 'prod-1', slug: 'widget', name: 'Widget', unitPrice: null };

  it('starts a new line at the minimum when asked for less', () => {
    const next = addToRfqDraft([], { ...item, quantity: 1 }, 10);
    expect(next).toHaveLength(1);
    expect(next[0]?.quantity).toBe(10);
  });

  it('keeps a requested quantity above the minimum', () => {
    expect(addToRfqDraft([], { ...item, quantity: 25 }, 10)[0]?.quantity).toBe(25);
  });

  it('adds 1 (unchanged) without a minimum', () => {
    expect(addToRfqDraft([], item)[0]?.quantity).toBe(1);
  });

  it('adds onto an existing line and leaves the passed-in array untouched', () => {
    const existing: RfqDraftItem[] = [{ ...line, quantity: 3 }];
    const next = addToRfqDraft(existing, { ...item, quantity: 10 }, 10);
    expect(next[0]?.quantity).toBe(13);
    expect(existing[0]?.quantity).toBe(3);
  });

  it('lifts an existing line to the minimum when the sum is still below it', () => {
    const existing: RfqDraftItem[] = [{ ...line, quantity: 3 }];
    expect(addToRfqDraft(existing, { ...item, quantity: 1 }, 10)[0]?.quantity).toBe(10);
  });
});

describe('quoteAddQuantity — what every "add to quote" starts at (US4 #13)', () => {
  it('is the minimum when the product has one, else 1', () => {
    expect(quoteAddQuantity(10)).toBe(10);
    expect(quoteAddQuantity(null)).toBe(1);
    expect(quoteAddQuantity(undefined)).toBe(1);
    expect(quoteAddQuantity(1)).toBe(1);
  });
});

describe('AddToRfqButton — the quote CTA shown when prices are hidden (US4 #13)', () => {
  it('starts its quantity input at the minimum and does not offer less', () => {
    const html = renderToString(
      <AddToRfqButton
        productId="prod-1"
        productSlug="widget"
        productName="Widget"
        withQuantity
        minOrderQuantity={10}
        locale="en-US"
      />,
    );
    const input = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('min="10"');
    expect(input).toContain('value="10"');
  });

  it('starts at 1 without a minimum', () => {
    const html = renderToString(
      <AddToRfqButton productId="prod-1" productSlug="widget" productName="Widget" withQuantity locale="en-US" />,
    );
    const input = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('min="1"');
    expect(input).toContain('value="1"');
  });
});

/**
 * Round B review — FR-032 interactively: "Set to 10 pcs" lifts a line below the minimum to it,
 * a quantity typed below the floor is kept while typing and lifted to the floor on blur, and a
 * valid quantity is saved as typed. The storefront suite renders on the server only, so these
 * rules are pure helpers tested here, and `DraftLine` is held to calling them.
 */
describe('draftQuantityFloor — the "Set to N" value', () => {
  it('is the minimum, or 1 without one', () => {
    expect(draftQuantityFloor(10)).toBe(10);
    expect(draftQuantityFloor(null)).toBe(1);
    expect(draftQuantityFloor(undefined)).toBe(1);
    expect(draftQuantityFloor(1)).toBe(1);
  });

  it('is what the fix button renders and what makes the warning go away', () => {
    const fixed = draftQuantityFloor(10);
    const html = renderLine({ quantity: fixed, minimum: 10, locale: 'en-US' });
    expect(qtyInput(html, 'Quantity')).toContain(`value="${fixed}"`);
    expect(qtyInput(html, 'Quantity')).not.toContain('aria-invalid');
    expect(html).not.toContain('Below the minimum');
  });
});

describe('draftQuantityOnType — what is saved while typing', () => {
  it('keeps a quantity below the floor unsaved (blur settles it)', () => {
    expect(draftQuantityOnType('4', 10)).toBeNull();
    expect(draftQuantityOnType('1', 10)).toBeNull();
  });

  it('keeps an empty or non-numeric box unsaved', () => {
    expect(draftQuantityOnType('', 10)).toBeNull();
    expect(draftQuantityOnType('  ', null)).toBeNull();
    expect(draftQuantityOnType('abc', 10)).toBeNull();
  });

  it('saves a whole quantity at or above the floor', () => {
    expect(draftQuantityOnType('10', 10)).toBe(10);
    expect(draftQuantityOnType('15', 10)).toBe(15);
    expect(draftQuantityOnType('12.7', 10)).toBe(12);
    expect(draftQuantityOnType('3', null)).toBe(3);
  });
});

describe('draftQuantityOnBlur — what is saved when the input loses focus', () => {
  it('lifts a quantity typed below the floor to the floor', () => {
    expect(draftQuantityOnBlur('4', 10, true)).toBe(10);
  });

  it('puts an empty or non-numeric box back at the floor', () => {
    expect(draftQuantityOnBlur('', 10, true)).toBe(10);
    expect(draftQuantityOnBlur('abc', 10, true)).toBe(10);
    expect(draftQuantityOnBlur('', null, true)).toBe(1);
  });

  it('keeps a valid quantity', () => {
    expect(draftQuantityOnBlur('15', 10, true)).toBe(15);
  });

  it('saves nothing when nothing was typed', () => {
    expect(draftQuantityOnBlur('3', 10, false)).toBeNull();
  });
});

describe('DraftLine — wiring', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../components/rfq/RfqDraftView.tsx'), 'utf8');

  it('floors the line, and its "Set to N" fix, at draftQuantityFloor', () => {
    expect(source).toContain('const floor = draftQuantityFloor(minimum);');
    expect(source).toContain('onClick={(): void => onQty(floor)}');
  });

  it('saves typed quantities through draftQuantityOnType and settles on blur through draftQuantityOnBlur', () => {
    expect(source).toContain('const typed = draftQuantityOnType(e.target.value, minimum);');
    expect(source).toContain('const settled = draftQuantityOnBlur(e.target.value, minimum, qtyText !== null);');
  });
});

/**
 * U4 (owner's manual test) — the browser's own `min` bubble fires only for a control of a
 * submitting form. The draft line and the quote CTA are client controls outside any form, so
 * typing below the floor is normalised on blur instead; this keeps it that way.
 */
describe('RFQ quantity inputs — no native validation bubble', () => {
  function outsideEveryForm(html: string, marker: string): boolean {
    const at = html.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const before = html.slice(0, at);
    return (before.match(/<form\b/g) ?? []).length === (before.match(/<\/form>/g) ?? []).length;
  }

  it('the draft line quantity is outside every form', () => {
    const html = renderLine({ quantity: 3, minimum: 10, locale: 'en-US' });
    expect(outsideEveryForm(html, 'type="number"')).toBe(true);
  });

  it('the quote CTA quantity is outside every form', () => {
    const html = renderToString(
      <AddToRfqButton productId="prod-1" productSlug="widget" productName="Widget" withQuantity minOrderQuantity={10} locale="en-US" />,
    );
    expect(outsideEveryForm(html, 'type="number"')).toBe(true);
  });
});
