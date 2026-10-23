import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListingPriceViewerContext } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import {
  presetConfig,
  type PresetName,
} from '../../../../packages/modules/price_lists/src/backend/services/precedence.js';

/**
 * Feature 160 (FR-026, SC-003) — price sort and the price-range filter, served
 * from the price surface, follow the prices the cards show, for every buyer of
 * the fixture, under the AF, SF, HY and AF-N presets. Replaces
 * `unit-price-ordering.test.ts`: the obligation (sort == card) is the same, the
 * machinery under it is the surface.
 *
 * The cards are the live batched resolution (`resolveListingPrices`) over the
 * whole catalogue; the ordering is `orderByUnitPrice`, unrestricted (the
 * profile is built), and restricted to the fixture's products (a stale profile
 * is answered live — the profile-miss path).
 */
const PRESETS: PresetName[] = ['AF', 'SF', 'HY', 'AF-N'];

describe('price surface — sort and range equal the cards, every buyer, every preset', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    // A mix of every tier: catalogue (E1), buyer books of both kinds (E3, F1),
    // a variant row, and a sale.
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
    await f.book({ audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] });
    await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
        { percent: '-2' },
        { product: f.products.P5, variant: f.variants.P5b, fixed: '60' },
      ],
    });
    await f.book({ audience: { groups: [f.groups.Gold] }, rows: [{ product: f.products.P3, fixed: '25' }] });
    await f.book({ type: 'sale', audience: 'everyone', rows: [{ product: f.products.P2, fixed: '44' }] });
  }, 5 * 60_000);

  afterAll(async () => {
    await sql(`delete from "price_profiles" where "precedence_version" = 2`);
    await sql(`delete from "price_list_precedence" where "version" = 2`);
    await sql(`update "price_list_precedence" set "state" = 'active' where "version" = 1`);
    await teardownBackendServer(h);
  });

  async function usePreset(preset: PresetName): Promise<void> {
    await switchPreset(preset);
    await prepare();
  }

  /**
   * A request never builds a surface (`contracts/price-surface.md` §3): each
   * buyer's request registers its profiles, then the worker's pass builds them.
   */
  async function prepare(): Promise<void> {
    for (const [, buyer] of buyers()) {
      await f.pricing.orderByUnitPrice({
        context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...buyer },
        direction: 'asc',
        after: null,
        limit: 1,
      });
    }
    await settlePriceSurface(h);
  }

  async function switchPreset(preset: PresetName): Promise<void> {
    await sql(`delete from "price_profiles" where "precedence_version" = 2`);
    await sql(`delete from "price_list_precedence" where "version" = 2`);
    if (preset === 'HY') {
      await sql(`update "price_list_precedence" set "state" = 'active' where "version" = 1`);
      return;
    }
    const config = presetConfig(preset);
    await sql(`update "price_list_precedence" set "state" = 'superseded' where "version" = 1`);
    await sql(
      `insert into "price_list_precedence" ("version", "cells", "category_before_attribute", "depth_mode", "state", "created_at", "activated_at")
       values (2, ?::jsonb, ?, ?, 'active', now(), now())`,
      [JSON.stringify(config.cells), config.categoryBeforeAttribute, config.depthMode],
    );
  }

  const buyers = (): Array<[string, Omit<ListingPriceViewerContext, 'salesChannel'>]> => [
    ['guest', {}],
    ['Acme', { organization: f.orgs.Acme }],
    ['AcmeW', { organization: f.orgs.AcmeW }],
    ['Beta', { organization: f.orgs.Beta }],
    ['Gamma', { organization: f.orgs.Gamma }],
    ['Ola (own group Gold)', { organization: f.orgs.Gamma, customerAccountId: f.accounts.ola }],
    ['Beta customer (own group Silver)', { organization: f.orgs.Beta, customerAccountId: f.accounts.betaSilver }],
  ];

  async function cards(context: ListingPriceViewerContext, ids?: readonly string[]) {
    const reads = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      listAll(): Promise<Array<{ id: string; attributeValues: Record<string, unknown> }>>;
      findByIds(ids: readonly string[]): Promise<Array<{ id: string; attributeValues: Record<string, unknown> }>>;
    }>('catalogProductReadPort');
    const products = ids ? await reads.findByIds(ids) : await reads.listAll();
    const listing = await f.pricing.resolveListingPrices({ products, context });
    return [...listing]
      .flatMap(([productId, price]) => (price.source === 'price_list' ? [{ productId, amount: price.amount }] : []))
      .sort((a, b) => Number(a.amount) - Number(b.amount) || (a.productId < b.productId ? -1 : 1));
  }

  async function walk(
    context: ListingPriceViewerContext,
    direction: 'asc' | 'desc',
    extra: { restrictToProductIds?: readonly string[]; amountRange?: { min?: string; max?: string } } = {},
  ) {
    const out: Array<{ productId: string; amount: string }> = [];
    let after: { amount: string; productId: string } | null = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const chunk = await f.pricing.orderByUnitPrice({ context, direction, after, limit: 3, ...extra });
      for (const row of chunk.rows) out.push({ productId: row.productId, amount: row.amount });
      if (chunk.rows.length === 0 || chunk.exhausted) break;
      const last = chunk.rows[chunk.rows.length - 1]!;
      after = { amount: last.amount, productId: last.productId };
    }
    return out;
  }

  for (const preset of PRESETS) {
    it(`${preset} — ascending, descending and keyset pages equal the card order, for every buyer`, async () => {
      await usePreset(preset);
      for (const [name, buyer] of buyers()) {
        const context: ListingPriceViewerContext = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...buyer };
        const expected = await cards(context);
        expect(await walk(context, 'asc'), `${preset} ${name} asc`).toEqual(expected);
        expect(await walk(context, 'desc'), `${preset} ${name} desc`).toEqual(
          [...expected].sort((a, b) => Number(b.amount) - Number(a.amount) || (a.productId < b.productId ? 1 : -1)),
        );
      }
    });

    it(`${preset} — a price range selects exactly the cards in range, for every buyer`, async () => {
      await usePreset(preset);
      for (const [name, buyer] of buyers()) {
        const context: ListingPriceViewerContext = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...buyer };
        const expected = (await cards(context)).filter((c) => Number(c.amount) >= 40 && Number(c.amount) <= 100);
        expect(await walk(context, 'asc', { amountRange: { min: '40', max: '100' } }), `${preset} ${name}`).toEqual(expected);
      }
    });
  }

  it('a buyer surface holding every product reads no everyone stream (SC-005, the all-products percentage)', async () => {
    await usePreset('HY');
    // Acme's book carries an all-products −2 %: every product differs from the
    // everyone answer, so Acme's surface holds every product the everyone one does.
    const context: ListingPriceViewerContext = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, organization: f.orgs.Acme };
    await walk(context, 'desc');
    const knex = h.em().getConnection().getKnex();
    const statements: string[] = [];
    const listen = (q: { sql: string }) => statements.push(q.sql);
    knex.on('query', listen);
    try {
      expect(await walk(context, 'desc')).toEqual([...(await cards(context))].reverse());
    } finally {
      knex.off('query', listen);
    }
    expect(statements.filter((sql) => /from "price_profile_prices" e\b/.test(sql))).toEqual([]);
  });

  it('a profile miss restricted to a set answers exactly, while the profile is stale', async () => {
    await usePreset('HY');
    const ids = Object.values(f.products).map((p) => p.id);
    await sql(`update "price_profiles" set "state" = 'building'`);
    for (const [name, buyer] of buyers()) {
      const context: ListingPriceViewerContext = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...buyer };
      expect(await walk(context, 'asc', { restrictToProductIds: ids }), name).toEqual(await cards(context, ids));
    }
  });

  it('a write marks the surface stale and the next ordering follows the new price', async () => {
    await usePreset('HY');
    const context: ListingPriceViewerContext = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } };
    await walk(context, 'asc');
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P3, fixed: '1' }] });
    // The everyone profile of the channel is marked for the one product the row prices.
    const marks = await sql(
      `select m."product_id" from "price_profile_stale_products" m
         join "price_profiles" p on p."id" = m."profile_id"
        where p."sales_channel_id" = ? and jsonb_array_length(p."book_vector") = 0 and p."precedence_version" = 1`,
      [f.channels.CH1.id],
    );
    expect(marks).toEqual([{ product_id: f.products.P3.id }]);
    await settlePriceSurface(h);
    const first = (await f.pricing.orderByUnitPrice({ context, direction: 'asc', after: null, limit: 1 })).rows[0];
    expect(first).toMatchObject({ productId: f.products.P3.id, amount: '1.0000' });
  });
});
