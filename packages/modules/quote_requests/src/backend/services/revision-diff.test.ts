import { describe, expect, it } from 'vitest';
import { RfqRevisionService } from './rfq-revision-service.js';
import type { QuoteRequestRevisionLine } from '../entities/quote-request-revision.entity.js';

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

// ---------------------------------------------------------------------------
// Feature 159 — the grouping in the snapshots and the customer's notice
// ---------------------------------------------------------------------------

describe('RfqRevisionService — grouping (T025)', () => {
  const G1 = 'g-1';
  const G2 = 'g-2';
  const placed = (productId: string, groupId: string | null, groupName: string | null, groupPosition: number | null, position: number) =>
    line({ productId, productName: productId.toUpperCase(), groupId, groupName, groupPosition, position });

  const diff = (beforeItems: QuoteRequestRevisionLine[], afterItems: QuoteRequestRevisionLine[]) =>
    svc.diffRevisions({ beforeHeaderNote: null, afterHeaderNote: null, beforeItems, afterItems });

  it('says the grouping changed — with no other key — when a line moves to another group', () => {
    const before = [placed('a', G1, 'One', 0, 0), placed('b', G1, 'One', 0, 1)];
    const after = [placed('a', G1, 'One', 0, 0), placed('b', null, null, null, 0)];
    expect(diff(before, after)).toEqual([{ kind: 'grouping' }]);
  });

  it('says so for a rename, a group reorder and a line reorder within a group', () => {
    const before = [placed('a', G1, 'One', 0, 0), placed('b', G2, 'Two', 1, 0), placed('c', G2, 'Two', 1, 1)];
    expect(diff(before, [placed('a', G1, 'Uno', 0, 0), placed('b', G2, 'Two', 1, 0), placed('c', G2, 'Two', 1, 1)])).toEqual([
      { kind: 'grouping' },
    ]);
    expect(diff(before, [placed('b', G2, 'Two', 0, 0), placed('c', G2, 'Two', 0, 1), placed('a', G1, 'One', 1, 0)])).toEqual([
      { kind: 'grouping' },
    ]);
    expect(diff(before, [placed('a', G1, 'One', 0, 0), placed('c', G2, 'Two', 1, 0), placed('b', G2, 'Two', 1, 1)])).toEqual([
      { kind: 'grouping' },
    ]);
  });

  it('says nothing when the arrangement as shown is unchanged, even if other things changed', () => {
    const before = [placed('a', G1, 'One', 0, 0), placed('b', null, null, null, 0)];
    const after = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }, placed('b', null, null, null, 0)];
    expect(diff(before, after)).toEqual([{ kind: 'line_quantity', productId: 'a', productName: 'A', before: 1, after: 5 }]);
  });

  it('an added or removed line is not by itself a grouping change', () => {
    const before = [placed('a', G1, 'One', 0, 0)];
    const after = [placed('a', G1, 'One', 0, 0), placed('b', G1, 'One', 0, 1)];
    expect(diff(before, after).map((entry) => entry.kind)).toEqual(['line_added']);
  });

  it('a snapshot written before the feature against an ungrouped one: no grouping entry', () => {
    const legacy = [line({ productId: 'b', productName: 'B' }), line({ productId: 'a', productName: 'A' })];
    const after = [placed('a', null, null, null, 0), placed('b', null, null, null, 1)];
    expect(diff(legacy, after)).toEqual([]);
  });

  it('a snapshot written before the feature against a grouped one: a grouping entry', () => {
    const legacy = [line({ productId: 'a', productName: 'A' })];
    expect(diff(legacy, [placed('a', G1, 'One', 0, 0)])).toEqual([{ kind: 'grouping' }]);
  });

  // Feature 159 (research N-32) — one product on several lines, in different groups.
  it('a split product: each line is compared with its own, and the entry names its group', () => {
    const before = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }, { ...placed('a', G2, 'Two', 1, 0), quantity: 3 }];
    const after = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }, { ...placed('a', G2, 'Two', 1, 0), quantity: 2 }];
    expect(diff(before, after)).toEqual([
      { kind: 'line_quantity', productId: 'a', productName: 'A', groupName: 'Two', before: 3, after: 2 },
    ]);
  });

  it('a line split off into another group: an addition and a quantity change, each naming its group', () => {
    const before = [{ ...placed('a', G1, 'One', 0, 0), quantity: 8 }];
    const after = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }, { ...placed('a', G2, 'Two', 1, 0), quantity: 3 }];
    expect(diff(before, after)).toEqual([
      { kind: 'line_added', productId: 'a', productName: 'A', groupName: 'Two', quantity: 3, agreedUnitPrice: null },
      { kind: 'line_quantity', productId: 'a', productName: 'A', groupName: 'One', before: 8, after: 5 },
    ]);
  });

  it('two groups of a split product swapped: only the arrangement changed', () => {
    const before = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }, { ...placed('a', G2, 'Two', 1, 0), quantity: 3 }];
    const after = [{ ...placed('a', G2, 'Two', 0, 0), quantity: 3 }, { ...placed('a', G1, 'One', 1, 0), quantity: 5 }];
    expect(diff(before, after)).toEqual([{ kind: 'grouping' }]);
  });

  it('an ungrouped line of a split product is named as ungrouped (`groupName: null`)', () => {
    const before = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }, { ...placed('a', null, null, null, 0), quantity: 3 }];
    const after = [{ ...placed('a', G1, 'One', 0, 0), quantity: 5 }];
    expect(diff(before, after)).toEqual([{ kind: 'line_removed', productId: 'a', productName: 'A', groupName: null }]);
  });

  it('records the lines in the order given, each with its place and its group, only groups holding lines', async () => {
    const created: unknown[] = [];
    const em = {
      find: async () => [
        { id: G1, name: 'One', position: 0 },
        { id: G2, name: 'Empty', position: 1 },
      ],
      create: (_entity: unknown, data: Record<string, unknown>) => {
        created.push(data);
        return data;
      },
      persist: () => ({ flush: async () => undefined }),
    };
    const recorder = new RfqRevisionService(() => em as never);
    const item = (productId: string, groupId: string | null, position: number) =>
      ({
        productId,
        variantId: null,
        productName: productId,
        productSlug: null,
        quantity: 1,
        desiredUnitPrice: null,
        agreedUnitPrice: '2.00',
        lineNote: null,
        lineCurrency: 'PLN',
        discountPercent: null,
        packagingUnitName: null,
        packagingUnitBaseQuantity: null,
        groupId,
        position,
      }) as never;
    await recorder.record({
      rfq: { id: 'q', currentRevisionNumber: 2, headerNote: null } as never,
      items: [item('a', G1, 0), item('b', null, 0), item('c', 'gone', 1)],
      actor: { adminUserId: 'admin' },
    });
    const snapshot = (created[0] as { itemsSnapshot: QuoteRequestRevisionLine[] }).itemsSnapshot;
    expect(snapshot.map((l) => [l.productId, l.position, l.groupId, l.groupName, l.groupPosition])).toEqual([
      ['a', 0, G1, 'One', 0],
      ['b', 0, null, null, null],
      ['c', 1, null, null, null],
    ]);
  });
});
