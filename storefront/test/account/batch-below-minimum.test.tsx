import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartDroppedLinesBanner } from '../../components/CartDroppedLinesBanner';
import {
  REPORT_CAP,
  REPORT_MORE_MAX,
  decodeConversionSkips,
  droppedBelowMinimumReason,
  encodeConversionSkips,
  reportMoreText,
  quickOrderBuildOutcome,
  quickOrderBuildRejectionText,
  quickOrderRejectionLabel,
  shoppingListSkipLabel,
} from '../../lib/batchReport';

/**
 * Feature 155, T121 — the batch paths' reports name the minimum (FR-011, US4): the buyer's
 * quick-order preview, the quick-order build's `rejected[]`, the shopping list's `skipped[]`
 * and the quote → cart dropped lines. PL and EN.
 */

describe('quick-order preview row (FR-011 (a))', () => {
  const row = { line: 2, raw: 'A,4', reason: 'below_minimum' as const, minimum: 10, productTotal: 7 };

  it("states the product's total in the file and the minimum", () => {
    expect(quickOrderRejectionLabel(row, 'en-US')).toBe("The product's total in this file is 7, minimum 10 pcs");
    expect(quickOrderRejectionLabel(row, 'pl-PL')).toBe('Łączna ilość produktu w tym pliku to 7, minimum 10 szt.');
  });

  it('labels the existing reasons instead of printing their codes', () => {
    const label = quickOrderRejectionLabel({ line: 3, raw: 'X,1', reason: 'product_not_found' }, 'en-US');
    expect(label).toBe('Product not found');
    expect(quickOrderRejectionLabel({ line: 3, raw: 'X,1', reason: 'product_not_found' }, 'pl-PL')).toBe(
      'Nie znaleziono produktu',
    );
  });
});

describe('quick-order build rejected[] (FR-011 (b))', () => {
  // Issue #790 — the line is named by the SKU the buyer imported, from the preview cookie; the
  // build's product and unit names are not carried (a URL once carried them, and a crafted one
  // put any text on the page).
  const pieces = { sku: 'BOLT-1', quantity: 5, kind: 'pieces' as const, minimum: 10 };

  it('names the line, the quantity and the minimum', () => {
    expect(quickOrderBuildRejectionText(pieces, 'en-US')).toBe('BOLT-1 × 5 — Below the minimum (10 pcs)');
    expect(quickOrderBuildRejectionText(pieces, 'pl-PL')).toBe('BOLT-1 × 5 — Poniżej minimum (10 szt.)');
  });

  it('states a packaging-unit minimum without the unit’s name', () => {
    const unit = { ...pieces, quantity: 64, kind: 'packaging_unit' as const, minimum: 2 };
    expect(quickOrderBuildRejectionText(unit, 'en-US')).toBe('BOLT-1 × 64 — Below the minimum (2 packaging units)');
    expect(quickOrderBuildRejectionText(unit, 'pl-PL')).toBe('BOLT-1 × 64 — Poniżej minimum (jednostki opakowania: 2)');
  });

  it('summarises a partial build and a build that added nothing', () => {
    expect(quickOrderBuildOutcome(3, 1, 'en-US')).toBe('Cart built from your import: 2 of 3 lines added.');
    expect(quickOrderBuildOutcome(3, 1, 'pl-PL')).toBe('Koszyk utworzony z importu: dodano 2 z 3 pozycji.');
    expect(quickOrderBuildOutcome(1, 1, 'en-US')).toBe('No lines were added to your cart.');
    expect(quickOrderBuildOutcome(2, 0, 'en-US')).toBe('Cart built from your import: 2 of 2 lines added.');
  });

  it('counts the lines not shown', () => {
    expect(reportMoreText(5, 'en-US')).toBe('+5 more');
    expect(reportMoreText(5, 'pl-PL')).toBe('+5 więcej');
  });

  it('no longer has a URL form', async () => {
    const report = await import('../../lib/batchReport');
    expect('encodeBuildRejections' in report).toBe(false);
    expect('decodeBuildRejections' in report).toBe(false);
  });
});

describe('shopping list skipped[] (FR-011)', () => {
  it('carries a capped, projected skip list across the redirect', () => {
    const skip = { itemId: 'i1', productId: 'p1', reason: 'below_minimum', minimum: 10, extra: 'dropped' };
    const many = Array.from({ length: REPORT_CAP + 2 }, (_, i) => ({ ...skip, itemId: `i${i}` }));
    const decoded = decodeConversionSkips(encodeConversionSkips(many));
    expect(decoded.lines).toHaveLength(REPORT_CAP);
    expect(decoded.lines[0]).toEqual({ itemId: 'i0', productId: 'p1', reason: 'below_minimum', minimum: 10 });
    expect(decoded.more).toBe(2);
    expect(decodeConversionSkips('%%%')).toEqual({ lines: [], more: 0 });
  });

  it('clamps a hand-made `more`', () => {
    const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    expect(decodeConversionSkips(encode({ lines: [], more: Number.MAX_SAFE_INTEGER })).more).toBe(REPORT_MORE_MAX);
  });

  it('states the minimum of a below_minimum skip', () => {
    expect(shoppingListSkipLabel({ reason: 'below_minimum', minimum: 10 }, 'en-US')).toBe('Below the minimum (10 pcs)');
    expect(shoppingListSkipLabel({ reason: 'below_minimum', minimum: 10 }, 'pl-PL')).toBe('Poniżej minimum (10 szt.)');
  });

  it('labels the existing skip reasons', () => {
    expect(shoppingListSkipLabel({ reason: 'product_archived' }, 'en-US')).toBe('Product archived');
    expect(shoppingListSkipLabel({ reason: 'product_not_found' }, 'pl-PL')).toBe('Produkt nie jest już dostępny');
  });
});

describe('CartDroppedLinesBanner — quote → cart (FR-011)', () => {
  const strings = (locale: string) => ({
    heading: 'Some lines were skipped',
    intro: 'These products were not added because:',
    reasonNotPurchasable: 'no longer available',
    reasonOutOfStock: 'out of stock',
    reasonNoPriceInCustomerList: 'no price available',
    reasonRemovedByConversion: 'skipped during conversion',
    reasonBelowMinimum: (minimum: number | undefined) => droppedBelowMinimumReason(minimum, locale),
  });

  it('states the minimum of a below_minimum line, distinct from no price (EN)', () => {
    const html = renderToString(
      <CartDroppedLinesBanner
        droppedLines={[
          { productId: 'p1', productName: 'Anchor bolt', reason: 'below_minimum', minimum: 10 },
          { productId: 'p2', productName: 'Dowel', reason: 'no_price_in_customer_list' },
        ]}
        strings={strings('en-US')}
      />,
    );
    expect(html).toContain('Anchor bolt');
    expect(html).toContain('below the minimum order quantity (minimum 10)');
    expect(html).toContain('no price available');
  });

  it('renders in Polish', () => {
    const html = renderToString(
      <CartDroppedLinesBanner
        droppedLines={[{ productId: 'p1', productName: 'Kotwa', reason: 'below_minimum', minimum: 10 }]}
        strings={strings('pl-PL')}
      />,
    );
    expect(html).toContain('poniżej minimalnej ilości zamówienia (minimum 10)');
  });
});
