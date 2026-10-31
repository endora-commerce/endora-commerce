import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DraftLine, strings } from '../../components/rfq/RfqDraftView';

/**
 * Review 2, finding 1 (release 0.108.0) — the draft line's proposed-price
 * placeholder wrote the catalogue snapshot with `toFixed(2)`, which rounds the
 * binary double. Since the owner ruling of 2026-10-25 (worked examples §10.18)
 * a unit price is carried at four places and shown with its significant
 * places, up to four, so the placeholder is the price as the product page
 * shows it: 9.045, not a rounding of it (`unitPriceDisplayText`).
 */
describe('DraftLine — the proposed-price placeholder', () => {
  it.each([
    [9.045, '9.045'],
    [1.005, '1.005'],
    [0.0125, '0.0125'],
    [12, '12.00'],
  ])('shows %s as %s', (amount, shown) => {
    const html = renderToString(
      <DraftLine
        line={{ productId: 'p', slug: 'p', name: 'P', unitPrice: { amount, currency: 'PLN' }, proposedUnitPrice: null, quantity: 1 }}
        t={strings('en-US')}
        locale="en-US"
        minimum={null}
        proposalsAllowed
        onQty={(): void => undefined}
        onProposedPrice={(): void => undefined}
        onRemove={(): void => undefined}
      />,
    );
    expect(html).toContain(`placeholder="${shown}"`);
  });
});

describe('DraftLine — a sub-cent price (§10.18)', () => {
  it('accepts a proposal at four places and shows the catalogue price and the line value by the rule', () => {
    const html = renderToString(
      <DraftLine
        line={{ productId: 'p', slug: 'p', name: 'P', unitPrice: { amount: 0.0125, currency: 'PLN' }, proposedUnitPrice: null, quantity: 10_000 }}
        t={strings('en-US')}
        locale="pl-PL"
        minimum={null}
        proposalsAllowed={false}
        onQty={(): void => undefined}
        onProposedPrice={(): void => undefined}
        onRemove={(): void => undefined}
      />,
    );
    // 0.0125 × 10 000 = 125.00 — the line value, rounded once.
    expect(html).toMatch(/0,0125\s*zł/);
    expect(html).toMatch(/125,00\s*zł/);
  });

  it('lets a proposal be typed at four places', () => {
    const html = renderToString(
      <DraftLine
        line={{ productId: 'p', slug: 'p', name: 'P', unitPrice: { amount: 0.0125, currency: 'PLN' }, proposedUnitPrice: null, quantity: 1 }}
        t={strings('en-US')}
        locale="pl-PL"
        minimum={null}
        proposalsAllowed
        onQty={(): void => undefined}
        onProposedPrice={(): void => undefined}
        onRemove={(): void => undefined}
      />,
    );
    expect(html).toContain('step="0.0001"');
  });
});
