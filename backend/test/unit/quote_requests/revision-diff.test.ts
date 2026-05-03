import { describe, expect, it } from 'vitest';
import { RfqRevisionService } from '../../../src/modules/quote_requests/services/rfq-revision-service.js';
import type { QuoteRequestRevisionLine } from '../../../src/modules/quote_requests/entities/quote-request-revision.entity.js';

const svc = new RfqRevisionService(() => ({}) as never);

function line(overrides: Partial<QuoteRequestRevisionLine>): QuoteRequestRevisionLine {
  return {
    productId: '00000000-0000-0000-0000-000000000001',
    variantId: null,
    productName: 'Default product',
    productSlug: null,
    quantity: 1,
    desiredUnitPrice: null,
    agreedUnitPrice: null,
    lineNote: null,
    lineCurrency: 'PLN',
    discountPercent: null,
    ...overrides,
  };
}

describe('RfqRevisionService.diffRevisions', () => {
  it('reports an empty diff when nothing changed', () => {
    const items = [line({ productId: 'a', productName: 'A' })];
    expect(
      svc.diffRevisions({
        beforeHeaderNote: 'note',
        afterHeaderNote: 'note',
        beforeItems: items,
        afterItems: items,
      }),
    ).toEqual([]);
  });

  it('reports header note changes', () => {
    const items = [line({ productId: 'a', productName: 'A' })];
    const diff = svc.diffRevisions({
      beforeHeaderNote: 'old',
      afterHeaderNote: 'new',
      beforeItems: items,
      afterItems: items,
    });
    expect(diff).toEqual([{ kind: 'header_note', before: 'old', after: 'new' }]);
  });

  it('reports added lines', () => {
    const before = [line({ productId: 'a', productName: 'A' })];
    const after = [
      line({ productId: 'a', productName: 'A' }),
      line({ productId: 'b', productName: 'B', quantity: 5, agreedUnitPrice: 9.5 }),
    ];
    const diff = svc.diffRevisions({
      beforeHeaderNote: null,
      afterHeaderNote: null,
      beforeItems: before,
      afterItems: after,
    });
    expect(diff).toEqual([
      { kind: 'line_added', productId: 'b', productName: 'B', quantity: 5, agreedUnitPrice: 9.5 },
    ]);
  });

  it('reports removed lines', () => {
    const before = [
      line({ productId: 'a', productName: 'A' }),
      line({ productId: 'b', productName: 'B' }),
    ];
    const after = [line({ productId: 'a', productName: 'A' })];
    const diff = svc.diffRevisions({
      beforeHeaderNote: null,
      afterHeaderNote: null,
      beforeItems: before,
      afterItems: after,
    });
    expect(diff).toEqual([{ kind: 'line_removed', productId: 'b', productName: 'B' }]);
  });

  it('reports quantity changes', () => {
    const before = [line({ productId: 'a', productName: 'A', quantity: 1 })];
    const after = [line({ productId: 'a', productName: 'A', quantity: 5 })];
    const diff = svc.diffRevisions({
      beforeHeaderNote: null,
      afterHeaderNote: null,
      beforeItems: before,
      afterItems: after,
    });
    expect(diff).toEqual([
      { kind: 'line_quantity', productId: 'a', productName: 'A', before: 1, after: 5 },
    ]);
  });

  it('reports agreed-unit-price changes', () => {
    const before = [line({ productId: 'a', productName: 'A', agreedUnitPrice: null })];
    const after = [line({ productId: 'a', productName: 'A', agreedUnitPrice: 12.5 })];
    const diff = svc.diffRevisions({
      beforeHeaderNote: null,
      afterHeaderNote: null,
      beforeItems: before,
      afterItems: after,
    });
    expect(diff).toEqual([
      {
        kind: 'line_agreed_unit_price',
        productId: 'a',
        productName: 'A',
        before: null,
        after: 12.5,
      },
    ]);
  });

  it('combines multiple kinds in one diff', () => {
    const before = [
      line({ productId: 'a', productName: 'A', quantity: 1, agreedUnitPrice: 10 }),
      line({ productId: 'b', productName: 'B' }),
    ];
    const after = [
      line({ productId: 'a', productName: 'A', quantity: 2, agreedUnitPrice: 9 }),
      line({ productId: 'c', productName: 'C', quantity: 3 }),
    ];
    const diff = svc.diffRevisions({
      beforeHeaderNote: 'h1',
      afterHeaderNote: 'h2',
      beforeItems: before,
      afterItems: after,
    });
    expect(diff).toContainEqual({ kind: 'header_note', before: 'h1', after: 'h2' });
    expect(diff).toContainEqual({
      kind: 'line_added',
      productId: 'c',
      productName: 'C',
      quantity: 3,
      agreedUnitPrice: null,
    });
    expect(diff).toContainEqual({ kind: 'line_removed', productId: 'b', productName: 'B' });
    expect(diff).toContainEqual({
      kind: 'line_quantity',
      productId: 'a',
      productName: 'A',
      before: 1,
      after: 2,
    });
    expect(diff).toContainEqual({
      kind: 'line_agreed_unit_price',
      productId: 'a',
      productName: 'A',
      before: 10,
      after: 9,
    });
  });
});
