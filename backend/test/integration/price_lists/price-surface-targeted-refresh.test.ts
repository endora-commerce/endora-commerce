import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListingPriceViewerContext } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';
import { setupPricingFixture, type ChannelRef, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (`contracts/price-surface.md` §4, owner ruling 2026-10-23) — the
 * price surface is refreshed **per trigger**, at (profile) and (profile,
 * product) granularity, never by rebuilding every profile:
 *
 * | Trigger | Marked |
 * | --- | --- |
 * | book header / status / channel set / members | the products the book's rows select, in the profiles containing the book |
 * | book delete | the same; buyer profiles holding the book are retired |
 * | row batch | the products the rows select, in the profiles containing the book |
 * | base prices | the product, in every profile of that currency |
 * | `product.*` | the product, in every profile |
 * | `category.updated.v1` | the products of the subtree, in every profile |
 * | `attribute.updated.v1` | the products the attribute's rows select, in the profiles containing those books |
 * | a channel's identity or lifecycle | every profile of that channel, rebuilt |
 * | organization chain / group | nothing is rebuilt; a new vector registers on request |
 * | status sweep | as a status change of the swept book |
 *
 * "Every profile" is the everyone profile of each channel and currency, and of
 * the buyer profiles only those whose books select the product or whose surface
 * holds a row for it (a buyer profile stores only what differs from everyone's;
 * any other buyer answers what the everyone profile answers).
 *
 * Each case proves (a) the refreshed surfaces order exactly as the live cards
 * do, for every warmed buyer, and (b) a profile the trigger does not concern is
 * neither marked nor rebuilt: its served generation and its revision stay.
 */
describe('price surface — targeted refresh per trigger', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);

  /** Book id → a short label for a profile's vector. */
  const letters = new Map<string, string>();
  let E = '';
  let A = '';
  let V = '';
  let G = '';
  let X = '';

  type Viewer = { label: string; context: ListingPriceViewerContext };
  let viewers: Viewer[] = [];

  const ctx = (channel: ChannelRef, extra: Omit<ListingPriceViewerContext, 'salesChannel'> = {}, currencyCode?: string): ListingPriceViewerContext => ({
    salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
    ...(currencyCode ? { currencyCode } : {}),
    ...extra,
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    // A euro base price, so the euro profiles hold rows.
    await f.setBase(f.products.P1, { product: [{ minQuantity: 1, maxQuantity: null, amount: '25' }], variants: {} }, 'EUR');
    E = (
      await f.book({
        name: 'E',
        audience: 'everyone',
        rows: [{ product: f.products.P1, fixed: '90' }, { category: f.categories.bolts, attribute: ['color', 'red'], fixed: '28' }],
      })
    ).id;
    A = (
      await f.book({
        name: 'A',
        audience: { organizations: [f.orgs.Acme] },
        rows: [{ product: f.products.P2, fixed: '40' }, { product: f.products.P5, variant: f.variants.P5b, fixed: '60' }],
      })
    ).id;
    V = (await f.book({ name: 'V', audience: { groups: [f.groups.VIP] }, rows: [{ category: f.categories.screws, percent: '-10' }] })).id;
    G = (await f.book({ name: 'G', audience: { groups: [f.groups.Gold] }, rows: [{ product: f.products.P3, fixed: '25' }] })).id;
    X = (
      await f.book({
        name: 'X',
        audience: { organizations: [f.orgs.Beta] },
        channels: [f.channels.CH2],
        rows: [{ product: f.products.P1, fixed: '70' }],
      })
    ).id;
    for (const [id, letter] of [
      [E, 'E'],
      [A, 'A'],
      [V, 'V'],
      [G, 'G'],
      [X, 'X'],
    ] as const) {
      letters.set(id, letter);
    }
    const { CH1, CH2, CH3 } = f.channels;
    viewers = [
      { label: 'guest CH1', context: ctx(CH1) },
      { label: 'guest CH2 PLN', context: ctx(CH2, {}, 'PLN') },
      { label: 'guest CH2 EUR', context: ctx(CH2, {}, 'EUR') },
      { label: 'guest CH3 EUR', context: ctx(CH3, {}, 'EUR') },
      { label: 'Acme', context: ctx(CH1, { organization: f.orgs.Acme }) },
      { label: 'AcmeW', context: ctx(CH1, { organization: f.orgs.AcmeW }) },
      { label: 'Beta', context: ctx(CH1, { organization: f.orgs.Beta }) },
      { label: 'Gamma + Gold', context: ctx(CH1, { organization: f.orgs.Gamma, customerGroupId: f.groups.Gold }) },
      { label: 'Beta CH2', context: ctx(CH2, { organization: f.orgs.Beta }, 'PLN') },
    ];
    await warm();
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  /** Register every viewer's profiles and build them (a request never builds). */
  async function warm(): Promise<void> {
    for (const viewer of viewers) {
      await f.pricing.orderByUnitPrice({ context: viewer.context, direction: 'asc', after: null, limit: 1 });
    }
    await settlePriceSurface(h);
  }

  interface ProfileState {
    label: string;
    stale: boolean;
    generation: number;
    revision: number;
    marks: string[];
  }

  const productLabel = (id: string): string =>
    (Object.entries(f.products).find(([, p]) => p.id === id)?.[0] as string | undefined) ?? id;

  /** Every profile of this file's channels, labelled `channel/currency/[books]`. */
  async function profiles(): Promise<Map<string, ProfileState>> {
    const channels = new Map(Object.entries(f.channels).map(([code, c]) => [c.id, code]));
    const rows = await sql<{
      id: string;
      sales_channel_id: string;
      currency_code: string;
      book_vector: Array<{ bookId: string; depth: number | null }>;
      stale: boolean;
      serving_generation: number;
      revision: number;
    }>(
      `select "id", "sales_channel_id", "currency_code", "book_vector", "stale", "serving_generation", "revision"
         from "price_profiles" where "sales_channel_id" = any(?::uuid[]) and "state" = 'ready'`,
      [`{${[...channels.keys()].join(',')}}`],
    );
    const marks = await sql<{ profile_id: string; product_id: string }>(
      `select "profile_id", "product_id" from "price_profile_stale_products"`,
    );
    const out = new Map<string, ProfileState>();
    for (const row of rows) {
      const vector = row.book_vector
        .map((v) => `${letters.get(v.bookId) ?? '?'}${v.depth ?? ''}`)
        .sort()
        .join(',');
      const label = `${channels.get(row.sales_channel_id)}/${row.currency_code.trim()}/[${vector}]`;
      out.set(label, {
        label,
        stale: row.stale,
        generation: Number(row.serving_generation),
        revision: Number(row.revision),
        marks: [...new Set(marks.filter((m) => m.profile_id === row.id).map((m) => productLabel(m.product_id)))].sort(),
      });
    }
    return out;
  }

  /** What the trigger left to do: `label → 'full'` or `label → [products]`, for every profile with work. */
  async function pending(): Promise<Record<string, 'full' | string[]>> {
    const out: Record<string, 'full' | string[]> = {};
    for (const [label, state] of await profiles()) {
      if (state.stale) out[label] = 'full';
      else if (state.marks.length > 0) out[label] = state.marks;
    }
    return out;
  }

  /** Settle, then: the profiles whose served surface moved (`full` = a new generation, `refresh` = rows replaced). */
  async function settleAndDiff(before: Map<string, ProfileState>): Promise<Record<string, 'full' | 'refresh'>> {
    await settlePriceSurface(h);
    const after = await profiles();
    const moved: Record<string, 'full' | 'refresh'> = {};
    for (const [label, state] of after) {
      const was = before.get(label);
      if (!was) continue;
      if (state.generation !== was.generation) moved[label] = 'full';
      else if (state.revision !== was.revision) moved[label] = 'refresh';
    }
    expect(await pending(), 'nothing left to do after the pass').toEqual({});
    return moved;
  }

  async function cards(context: ListingPriceViewerContext) {
    const reads = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      listAll(): Promise<Array<{ id: string; attributeValues: Record<string, unknown> }>>;
    }>('catalogProductReadPort');
    const products = (await reads.listAll()).filter((p) => Object.values(f.products).some((q) => q.id === p.id));
    const listing = await f.pricing.resolveListingPrices({ products, context });
    return [...listing]
      .flatMap(([productId, price]) => (price.source === 'price_list' ? [{ productId, amount: price.amount }] : []))
      .sort((a, b) => Number(a.amount) - Number(b.amount) || (a.productId < b.productId ? -1 : 1));
  }

  /** (a) — every warmed buyer's sorted surface equals its live cards, over the fixture's products. */
  async function expectIdentity(): Promise<void> {
    const ids = Object.values(f.products).map((p) => p.id);
    for (const viewer of viewers) {
      const sorted: Array<{ productId: string; amount: string }> = [];
      let after: { amount: string; productId: string } | null = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const chunk = await f.pricing.orderByUnitPrice({
          context: viewer.context,
          direction: 'asc',
          after,
          limit: 2,
          restrictToProductIds: ids,
        });
        for (const row of chunk.rows) sorted.push({ productId: row.productId, amount: row.amount });
        if (chunk.rows.length === 0 || chunk.exhausted) break;
        const last = chunk.rows[chunk.rows.length - 1]!;
        after = { amount: last.amount, productId: last.productId };
      }
      expect(sorted, viewer.label).toEqual(await cards(viewer.context));
    }
  }

  const emit = async (event: string, payload: Record<string, unknown>) => {
    h.eventBus.emit(event as never, { eventId: `t-${Date.now()}`, occurredAt: new Date().toISOString(), ...payload } as never);
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  it('starts from built, identical surfaces with nothing to do', async () => {
    expect(await pending()).toEqual({});
    expect([...(await profiles()).keys()].sort()).toEqual([
      'CH1/PLN/[A0,V]',
      'CH1/PLN/[A1,V]',
      'CH1/PLN/[G]',
      'CH1/PLN/[V]',
      'CH1/PLN/[]',
      'CH2/EUR/[]',
      'CH2/PLN/[X0]',
      'CH2/PLN/[]',
      'CH3/EUR/[]',
    ]);
    await expectIdentity();
  });

  it('a buyer book header change refreshes its products in the profiles containing it, and only there', async () => {
    const before = await profiles();
    const book = await f.books.read(A, { all: true, organizationIds: new Set() });
    await f.system(() => f.books.patchBook(A, { priority: 5 }, { expectedVersion: book.version }));
    expect(await pending()).toEqual({ 'CH1/PLN/[A0,V]': ['P2', 'P5'], 'CH1/PLN/[A1,V]': ['P2', 'P5'] });
    expect(await settleAndDiff(before)).toEqual({ 'CH1/PLN/[A0,V]': 'refresh', 'CH1/PLN/[A1,V]': 'refresh' });
    await expectIdentity();
  });

  it('a name-only patch marks nothing', async () => {
    const book = await f.books.read(A, { all: true, organizationIds: new Set() });
    await f.system(() => f.books.patchBook(A, { name: 'A renamed' }, { expectedVersion: book.version }));
    expect(await pending()).toEqual({});
  });

  it('a buyer book row batch refreshes the products of its rows, in the profiles containing it', async () => {
    const before = await profiles();
    await f.system(() =>
      f.books.replaceRows(G, {
        upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '33' } }],
        delete: [],
      }),
    );
    expect(await pending()).toEqual({ 'CH1/PLN/[G]': ['P1'] });
    expect(await settleAndDiff(before)).toEqual({ 'CH1/PLN/[G]': 'refresh' });
    await expectIdentity();
  });

  it('an everyone book row batch refreshes the everyone profile of its channel, and the buyer profiles that price the product', async () => {
    const before = await profiles();
    await f.system(() =>
      f.books.replaceRows(E, {
        upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '45' } }],
        delete: [],
      }),
    );
    // P2 is in Screws: V's category row selects it; A has a P2 row; G does not price it.
    expect(await pending()).toEqual({
      'CH1/PLN/[]': ['P2'],
      'CH1/PLN/[A0,V]': ['P2'],
      'CH1/PLN/[A1,V]': ['P2'],
      'CH1/PLN/[V]': ['P2'],
    });
    expect(await settleAndDiff(before)).toEqual({
      'CH1/PLN/[]': 'refresh',
      'CH1/PLN/[A0,V]': 'refresh',
      'CH1/PLN/[A1,V]': 'refresh',
      'CH1/PLN/[V]': 'refresh',
    });
    await expectIdentity();
  });

  it('a base price refreshes the product in every profile of that currency that can price it — no other currency', async () => {
    const before = await profiles();
    await f.setBase(f.products.P3, { product: [{ minQuantity: 1, maxQuantity: null, amount: '27' }], variants: {} });
    // P3 is in Bolts: G prices it; V (Screws), A and X do not, and their surfaces hold no P3 row.
    expect(await pending()).toEqual({ 'CH1/PLN/[]': ['P3'], 'CH1/PLN/[G]': ['P3'], 'CH2/PLN/[]': ['P3'] });
    expect(await settleAndDiff(before)).toEqual({ 'CH1/PLN/[]': 'refresh', 'CH1/PLN/[G]': 'refresh', 'CH2/PLN/[]': 'refresh' });
    await expectIdentity();
  });

  it('a product event refreshes that product in every profile of every channel and currency that can price it', async () => {
    const before = await profiles();
    await emit('product.updated.v1', { productId: f.products.P1.id, changedFields: ['attributeValues'] });
    // P1: E and X price it, V selects it (Screws), G's surface holds its row.
    expect(await pending()).toEqual({
      'CH1/PLN/[]': ['P1'],
      'CH1/PLN/[A0,V]': ['P1'],
      'CH1/PLN/[A1,V]': ['P1'],
      'CH1/PLN/[V]': ['P1'],
      'CH1/PLN/[G]': ['P1'],
      'CH2/PLN/[]': ['P1'],
      'CH2/PLN/[X0]': ['P1'],
      'CH2/EUR/[]': ['P1'],
      'CH3/EUR/[]': ['P1'],
    });
    const moved = await settleAndDiff(before);
    expect(Object.keys(moved).sort()).toEqual(Object.keys(await profilesWith(before, () => true)).sort());
    expect(new Set(Object.values(moved))).toEqual(new Set(['refresh']));
    await expectIdentity();
  });

  /** The labels of `profiles` matching `predicate`, as a record (for comparisons). */
  async function profilesWith(state: Map<string, ProfileState>, predicate: (label: string) => boolean) {
    return Object.fromEntries([...state.keys()].filter(predicate).map((label) => [label, true]));
  }

  it('a category event refreshes the products of its subtree, wherever they can be priced', async () => {
    const before = await profiles();
    await emit('category.updated.v1', { categoryId: f.categories.bolts });
    expect(await pending()).toEqual({
      'CH1/PLN/[]': ['P3'],
      'CH1/PLN/[G]': ['P3'],
      'CH2/PLN/[]': ['P3'],
      'CH2/EUR/[]': ['P3'],
      'CH3/EUR/[]': ['P3'],
    });
    const moved = await settleAndDiff(before);
    expect(moved).toEqual({
      'CH1/PLN/[]': 'refresh',
      'CH1/PLN/[G]': 'refresh',
      'CH2/PLN/[]': 'refresh',
      'CH2/EUR/[]': 'refresh',
      'CH3/EUR/[]': 'refresh',
    });
    await expectIdentity();
  });

  it('an attribute event refreshes the products its rows select, in the profiles containing those books', async () => {
    const before = await profiles();
    await emit('attribute.updated.v1', { attributeKey: 'color' });
    // Only E has a `color` row (Bolts ∩ red → P3); E is an everyone book on CH1.
    expect(await pending()).toEqual({ 'CH1/PLN/[]': ['P3'], 'CH1/PLN/[G]': ['P3'] });
    expect(await settleAndDiff(before)).toEqual({ 'CH1/PLN/[]': 'refresh', 'CH1/PLN/[G]': 'refresh' });
    await expectIdentity();
  });

  it('an attribute nobody prices on marks nothing', async () => {
    await emit('attribute.updated.v1', { attributeKey: 'material' });
    expect(await pending()).toEqual({});
  });

  it('a channel event rebuilds that channel’s profiles and no other', async () => {
    const before = await profiles();
    await emit('sales_channels.identity_changed', { channelCode: f.channels.CH2.code });
    expect(await pending()).toEqual({ 'CH2/PLN/[]': 'full', 'CH2/PLN/[X0]': 'full', 'CH2/EUR/[]': 'full' });
    expect(await settleAndDiff(before)).toEqual({ 'CH2/PLN/[]': 'full', 'CH2/PLN/[X0]': 'full', 'CH2/EUR/[]': 'full' });
    await expectIdentity();
  });

  it('a display-mode override marks nothing (the surface holds no display mode)', async () => {
    const service = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      upsertDisplayModeOverride(scope: 'product', targetId: string, mode: 'net_only' | 'inherit'): Promise<unknown>;
    }>('priceListService');
    await service.upsertDisplayModeOverride('product', f.products.P1.id, 'net_only');
    expect(await pending()).toEqual({});
    await service.upsertDisplayModeOverride('product', f.products.P1.id, 'inherit');
    expect(await pending()).toEqual({});
  });

  it('a buyer whose group changes is not a rebuild: the new vector registers on request, nothing else moves', async () => {
    const before = await profiles();
    const moved = { label: 'AcmeW in Gold', context: ctx(f.channels.CH1, { organization: { ...f.orgs.AcmeW, customerGroupId: f.groups.Gold } }) };
    await f.pricing.orderByUnitPrice({ context: moved.context, direction: 'asc', after: null, limit: 1 });
    expect(await pending()).toEqual({});
    const registered = await sql<{ n: number }>(
      `select count(*)::int as n from "price_profiles" where "state" = 'building' and "sales_channel_id" = ?`,
      [f.channels.CH1.id],
    );
    expect(registered[0]!.n).toBe(1);
    expect(await settleAndDiff(before)).toEqual({});
    viewers.push(moved);
    try {
      await expectIdentity();
    } finally {
      viewers.pop();
    }
  });

  it('a status sweep refreshes the swept book’s products in the profiles containing it', async () => {
    const DAY = 86_400_000;
    const G2 = (
      await f.book({
        name: 'G2',
        audience: { groups: [f.groups.Gold] },
        rows: [{ product: f.products.P2, fixed: '11' }],
        startsAt: new Date(Date.now() + DAY),
      })
    ).id;
    letters.set(G2, 'G2');
    // Scheduled for tomorrow: activation marks the profiles containing it — none holds it yet.
    expect(await pending()).toEqual({});
    // A vector holding G2 exists only once it applies; build a profile for it by hand-moving the start.
    await sql(`update "price_lists" set "starts_at" = now() - interval '1 minute' where "id" = ?`, [G2]);
    await warm();
    expect(await pending()).toEqual({});
    const before = await profiles();
    const worker = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      handle: { statusWorker: { sweep(now: Date): Promise<{ scheduledToActive: number; activeToExpired: number }> } };
    }>('priceLists').handle.statusWorker;
    expect((await worker.sweep(new Date())).scheduledToActive).toBe(1);
    expect(await pending()).toEqual({ 'CH1/PLN/[G,G2]': ['P2'] });
    expect(await settleAndDiff(before)).toEqual({ 'CH1/PLN/[G,G2]': 'refresh' });
    await expectIdentity();
  });

  it('draftify and delete: the book’s products in the profiles containing it; a deleted book’s buyer profiles are retired', async () => {
    let before = await profiles();
    await f.system(() => f.books.draftify(A));
    // `[A1,G]` is the profile of AcmeW in Gold, registered by the group-change case.
    expect(await pending()).toEqual({
      'CH1/PLN/[A0,V]': ['P2', 'P5'],
      'CH1/PLN/[A1,V]': ['P2', 'P5'],
      'CH1/PLN/[A1,G]': ['P2', 'P5'],
    });
    expect(await settleAndDiff(before)).toEqual({
      'CH1/PLN/[A0,V]': 'refresh',
      'CH1/PLN/[A1,V]': 'refresh',
      'CH1/PLN/[A1,G]': 'refresh',
    });
    await expectIdentity();

    before = await profiles();
    await f.system(() => f.books.deleteBook(V));
    const after = await profiles();
    // Every profile whose vector held V is gone; nothing else is marked.
    expect([...after.keys()].filter((label) => label.includes('V'))).toEqual([]);
    expect(await pending()).toEqual({});
    await warm();
    const rebuilt = await profiles();
    for (const [label, state] of before) {
      if (label.includes('V') || !rebuilt.has(label)) continue;
      expect({ label, generation: rebuilt.get(label)!.generation, revision: rebuilt.get(label)!.revision }).toEqual({
        label,
        generation: state.generation,
        revision: state.revision,
      });
    }
    await expectIdentity();
  });

  it('a write landing while the worker refreshes is not lost', async () => {
    const before = await profiles();
    // P5 has no catalogue row, so its base price is what a guest pays.
    await f.setBase(f.products.P5, { product: [{ minQuantity: 1, maxQuantity: null, amount: '52' }], variants: {} });
    expect(Object.keys(await pending()).length).toBeGreaterThan(0);
    // The second write commits while the first pass is refreshing (on its first profile lock).
    const driver = h.em().getDriver() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = driver.execute;
    let written = false;
    driver.execute = async function (this: unknown, ...args: unknown[]) {
      if (!written && /pg_advisory_xact_lock/.test(String(args[0]))) {
        written = true;
        driver.execute = original;
        await f.setBase(f.products.P5, { product: [{ minQuantity: 1, maxQuantity: null, amount: '3' }], variants: {} });
      }
      return original.apply(this, args);
    };
    try {
      await settleAndDiff(before);
    } finally {
      driver.execute = original;
    }
    expect(written).toBe(true);
    await expectIdentity();
    const guest = await f.pricing.orderByUnitPrice({
      context: viewers[0]!.context,
      direction: 'asc',
      after: null,
      limit: 1,
      restrictToProductIds: Object.values(f.products).map((p) => p.id),
    });
    expect(guest.rows[0]).toMatchObject({ productId: f.products.P5.id, amount: '3.0000' });
  });
});
