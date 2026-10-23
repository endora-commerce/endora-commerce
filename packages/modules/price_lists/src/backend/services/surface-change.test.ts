import { describe, expect, it } from 'vitest';
import {
  mergePlan,
  planMarks,
  productsOfSelections,
  targetsForBooks,
  targetsForProducts,
  type SelectingBooks,
  type SurfaceProfileRef,
} from './surface-change.js';

/**
 * Feature 160 (`contracts/price-surface.md` §4, owner ruling 2026-10-23) — the
 * pure half of the targeted refresh: which profiles a change reaches, which
 * products a row set prices, and which marks follow. The database half is
 * `backend/test/integration/price_lists/price-surface-targeted-refresh.test.ts`.
 */
const everyoneCh1: SurfaceProfileRef = { id: 'e1', channelId: 'ch1', currencyCode: 'PLN', bookIds: [] };
const everyoneCh2: SurfaceProfileRef = { id: 'e2', channelId: 'ch2', currencyCode: 'PLN', bookIds: [] };
const everyoneEur: SurfaceProfileRef = { id: 'e3', channelId: 'ch2', currencyCode: 'EUR', bookIds: [] };
const acme: SurfaceProfileRef = { id: 'acme', channelId: 'ch1', currencyCode: 'PLN', bookIds: ['A', 'V'] };
const beta: SurfaceProfileRef = { id: 'beta', channelId: 'ch1', currencyCode: 'PLN', bookIds: ['V'] };
const all = [everyoneCh1, everyoneCh2, everyoneEur, acme, beta];

const none: SelectingBooks = { byProduct: new Map(), any: new Set() };

describe('surface change — targets', () => {
  it('a buyer book reaches the profiles whose vector holds it, at the own level', () => {
    const targets = targetsForBooks(
      [{ bookId: 'A', currencyCode: 'PLN', audienceKind: 'organizations', isSystem: false, channelIds: ['ch1'], live: true }],
      all,
    );
    expect(targets).toEqual({ own: [acme], shared: [] });
  });

  it('an everyone book reaches every profile of its currency on its channels, at the shared level', () => {
    const targets = targetsForBooks(
      [{ bookId: 'E', currencyCode: 'pln ', audienceKind: 'everyone', isSystem: false, channelIds: ['ch1'], live: true }],
      all,
    );
    expect(targets.own).toEqual([]);
    expect(targets.shared.map((p) => p.id).sort()).toEqual(['acme', 'beta', 'e1']);
  });

  it('a base book is channel-independent', () => {
    const targets = targetsForBooks(
      [{ bookId: 'B', currencyCode: 'PLN', audienceKind: 'everyone', isSystem: true, channelIds: [], live: true }],
      all,
    );
    expect(targets.shared.map((p) => p.id).sort()).toEqual(['acme', 'beta', 'e1', 'e2']);
  });

  it('a book that is live neither before nor after reaches nothing; before or after is enough', () => {
    const draft = { bookId: 'A', currencyCode: 'PLN', audienceKind: 'organizations' as const, isSystem: false, channelIds: ['ch1'] };
    expect(targetsForBooks([{ ...draft, live: false }, { ...draft, live: false }], all)).toEqual({ own: [], shared: [] });
    expect(targetsForBooks([{ ...draft, live: true }, { ...draft, live: false }], all).own).toEqual([acme]);
  });

  it('the channel sets before and after are both reached', () => {
    const facts = { bookId: 'E', currencyCode: 'PLN', audienceKind: 'everyone' as const, isSystem: false, live: true };
    const targets = targetsForBooks([{ ...facts, channelIds: ['ch1'] }, { ...facts, channelIds: ['ch2'] }], all);
    expect(targets.shared.map((p) => p.id).sort()).toEqual(['acme', 'beta', 'e1', 'e2']);
  });

  it('a product change reaches every profile, or those of the named currencies', () => {
    expect(targetsForProducts(all).shared).toHaveLength(5);
    expect(targetsForProducts(all, ['eur']).shared).toEqual([everyoneEur]);
  });
});

describe('surface change — products of a row set', () => {
  const inCategory = async (id: string) => (id === 'screws' ? ['p1', 'p2'] : []);

  it('product and variant rows name their product; category rows the products assigned to it', async () => {
    expect(
      await productsOfSelections(
        [
          { productId: 'p9', categoryId: null, attributeKey: null },
          { productId: null, categoryId: 'screws', attributeKey: 'color' },
        ],
        inCategory,
      ),
    ).toEqual(new Set(['p9', 'p1', 'p2']));
  });

  it('an attribute-only or an all-products row concerns every product', async () => {
    expect(await productsOfSelections([{ productId: null, categoryId: null, attributeKey: 'color' }], inCategory)).toBe('all');
    expect(await productsOfSelections([{ productId: null, categoryId: null, attributeKey: null }], inCategory)).toBe('all');
  });
});

describe('surface change — marks', () => {
  it('own targets take every product; an everyone profile every product; a buyer profile only what its books select or it holds', () => {
    const plan = planMarks({
      targets: { own: [acme], shared: [everyoneCh1, beta] },
      products: new Set(['p1', 'p3']),
      selecting: { byProduct: new Map([['p1', new Set(['V'])]]), any: new Set() },
      held: new Map(),
      partialLimit: 100,
    });
    expect(plan.full).toEqual(new Set());
    expect(plan.products).toEqual(
      new Map([
        ['acme', new Set(['p1', 'p3'])],
        ['e1', new Set(['p1', 'p3'])],
        ['beta', new Set(['p1'])],
      ]),
    );
  });

  it('a buyer profile holding a row for the product is marked even when no book selects it any more', () => {
    const plan = planMarks({
      targets: { own: [], shared: [beta] },
      products: new Set(['p3']),
      selecting: none,
      held: new Map([['beta', new Set(['p3'])]]),
      partialLimit: 100,
    });
    expect(plan.products).toEqual(new Map([['beta', new Set(['p3'])]]));
  });

  it('a book that may select anything makes every product relevant to its profiles', () => {
    const plan = planMarks({
      targets: { own: [], shared: [beta] },
      products: new Set(['p7']),
      selecting: { byProduct: new Map(), any: new Set(['V']) },
      held: new Map(),
      partialLimit: 100,
    });
    expect(plan.products).toEqual(new Map([['beta', new Set(['p7'])]]));
  });

  it('every product, or more than the partial limit, rebuilds every target whole', () => {
    const targets = { own: [acme], shared: [everyoneCh1, beta] };
    expect(planMarks({ targets, products: 'all', selecting: none, held: new Map(), partialLimit: 100 }).full).toEqual(
      new Set(['acme', 'e1', 'beta']),
    );
    expect(planMarks({ targets, products: new Set(['a', 'b', 'c']), selecting: none, held: new Map(), partialLimit: 2 }).full).toEqual(
      new Set(['acme', 'e1', 'beta']),
    );
  });

  it('merging keeps the union, and a profile rebuilt whole carries no product marks', () => {
    const merged = mergePlan(
      { full: new Set(), products: new Map([['e1', new Set(['p1'])], ['beta', new Set(['p1'])]]) },
      { full: new Set(['beta']), products: new Map([['e1', new Set(['p2'])]]) },
    );
    expect(merged).toEqual({ full: new Set(['beta']), products: new Map([['e1', new Set(['p1', 'p2'])]]) });
  });
});
