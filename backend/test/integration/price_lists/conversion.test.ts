import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Migration } from '@mikro-orm/migrations';
import { Migration20261022T111811CatalogPriceFieldsRemoved } from '@endora-commerce/mod-catalog/migrations';
import { Migration20261022T111815PriceListsPriceBooksConversion } from '@endora-commerce/mod-price-lists/migrations';
import { Migration20261023T234605ProductFeedsPriceListFkDropped } from '@endora-commerce/mod-product-feeds/migrations';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';

/**
 * Feature 160 (FR-041, FR-042, SC-006; `contracts/conversion-and-removal.md`
 * §1, §2, §5) — the one-shot conversion of this release.
 *
 * The database is taken back to the state before it — the two migrations'
 * `down`, `price_lists`' first, then `catalog`'s, the reverse of the order a
 * `migrate` runs them in — and given old-model data: Default-list brackets in
 * two currencies, a product priced only by its `defaultPrice` key, a variant
 * with a price override, a rule-based list with its roster, brackets, matrix
 * entries and feature-014 rows, the Default list's own old-model matrix
 * entries, and a price book written through the new API before the
 * conversion. Then both `up`s run, `catalog`'s first.
 *
 * After it: every Default bracket is a row of its currency's base book; the
 * catalogue fields are gone and **not** converted, so the product and the
 * variant they priced have no price; no old-model list is left, while the
 * price book is; the old tables and columns are absent; precedence v1 is HY.
 *
 * Owner decision 2026-10-24 (research R4, the departure from N13) — an
 * instance on 0.107.0 can have a product feed pinned to an old-model list,
 * held by `product_feeds_price_list_fk` (`on delete restrict`). The upgrade
 * must not stop there: the conversion **retires** a list something still
 * refers to — kept, stripped of its rows, channels and audience, `expired`
 * and renamed — and `product_feeds`' own migration, which runs after it,
 * drops the key. The feed then warns `not_active`, its next run withdraws the
 * published file, and deleting the retired book later leaves the feed
 * answering `not_found`.
 */
describe('price_lists — the conversion (feature 160, SC-006)', () => {
  let h: BackendServerHandle;
  let pricing: PricingService;
  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    h.em().getConnection().execute<T[]>(statement, params);
  const stamp = randomUUID().slice(0, 8);
  const DEFAULT_LIST = '00000000-0000-4000-8000-00000000d51b';

  const ids = {
    X: randomUUID(),
    W: randomUUID(),
    Y: randomUUID(),
    Z: randomUUID(),
    V: randomUUID(),
    org: randomUUID(),
    category: randomUUID(),
    channel: randomUUID(),
    oldList: randomUUID(),
    book: randomUUID(),
    pinnedList: randomUUID(),
  };
  const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
  const RETIRED_SUFFIX = ' (removed by the 0.108.0 upgrade)';
  let feed: { id: string; token: string };

  async function run(migration: Migration, direction: 'up' | 'down'): Promise<void> {
    await migration[direction]();
    for (const query of migration.getQueries()) await h.em().execute(query as string);
  }

  const catalogMigration = () => new Migration20261022T111811CatalogPriceFieldsRemoved(h.em().getDriver(), h.em().config);
  const conversion = () => new Migration20261022T111815PriceListsPriceBooksConversion(h.em().getDriver(), h.em().config);
  const feedKeyDropped = () => new Migration20261023T234605ProductFeedsPriceListFkDropped(h.em().getDriver(), h.em().config);

  const generate = (feedId: string) => h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
  const publicStatus = async (token: string) =>
    (await h.app.inject({ method: 'GET', url: `/api/v1/public/product-feeds/${token}` })).statusCode;
  async function feedWarning(feedId: string): Promise<string | null> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/product-feeds/${feedId}`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { feed?: { pinnedPriceBookWarning: string | null }; pinnedPriceBookWarning?: string | null } })
      .data;
    return data.feed?.pinnedPriceBookWarning ?? data.pinnedPriceBookWarning ?? null;
  }

  async function product(id: string, sku: string, type: string, attributeValues: Record<string, unknown>): Promise<void> {
    await sql(
      `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "attribute_values", "created_at", "updated_at")
       values (?, ?, ?, ?, 'active', ?::jsonb, '{}'::jsonb, ?::jsonb, now(), now())`,
      [id, `${sku}-${stamp}`, `${sku.toLowerCase()}-${stamp}`, type, JSON.stringify({ 'en-US': sku }), JSON.stringify(attributeValues)],
    );
  }

  async function columns(table: string): Promise<string[]> {
    return (
      await sql<{ column_name: string }>(
        `select "column_name" from information_schema.columns where "table_name" = ? order by "column_name"`,
        [table],
      )
    ).map((r) => r.column_name);
  }

  async function baseRows(productId: string): Promise<Array<{ currency: string; min: number; max: number | null; amount: string }>> {
    return (
      await sql<{ currency_code: string; min_quantity: number; max_quantity: number | null; amount: string }>(
        `select b."currency_code", e."min_quantity", e."max_quantity", e."amount"
           from "price_list_matrix_entries" e join "price_lists" b on b."id" = e."price_list_id" and b."is_system"
          where e."product_id" = ?
          order by b."currency_code", e."min_quantity"`,
        [productId],
      )
    ).map((r) => ({
      currency: r.currency_code.trim(),
      min: Number(r.min_quantity),
      max: r.max_quantity === null ? null : Number(r.max_quantity),
      amount: Number(r.amount).toFixed(4),
    }));
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const container = h.container as unknown as { resolve<T>(name: string): T };
    pricing = container.resolve<{ handle: { pricingEngine: PricingService } }>('priceLists').handle.pricingEngine;

    // ── a feed that publishes, on 0.107.0 to be pinned to an old-model list
    await setChannelStorefrontUrl(h, 'pl_retail');
    const retail = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const feedBook = await seedPriceBookSql(h.em(), {
      name: `Conversion feed book ${stamp}`,
      audience: 'everyone',
      channelIds: [retail.id],
      rows: [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID].map((productId) => ({ productId, fixed: '42.0000' })),
    });
    const templates = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', ...ADMIN });
    const templateId = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> }).data.find(
      (t) => t.systemCode === 'google_merchant_v1',
    )!.id;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Conversion feed ${stamp}`,
        slug: `conversion-feed-${stamp}`,
        feedTemplateId: templateId,
        salesChannelId: retail.id,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        priceListId: feedBook,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json() as { data: { feed: { id: string }; issuedToken: { token: string } } };
    feed = { id: body.data.feed.id, token: body.data.issuedToken.token };
    expect(['completed', 'completed_with_warnings']).toContain((await generate(feed.id)).status);
    expect(await publicStatus(feed.token)).toBe(200);

    // ── back to the state before the release's removal, in reverse order
    await run(feedKeyDropped(), 'down');
    await run(conversion(), 'down');
    await run(catalogMigration(), 'down');

    // ── old-model data
    await sql(
      `insert into "sales_channels" ("id", "code", "name", "languages", "default_language", "currencies", "default_currency",
                                     "active", "system_default", "version", "is_public", "status", "created_at", "updated_at")
       values (?, ?, '{"en-US":"Conversion"}', '["pl-PL"]', 'pl-PL', '["PLN","EUR"]', 'PLN', true, false, 1, true, 'active', now(), now())`,
      [ids.channel, `conv-${stamp}`],
    );
    await sql(
      `insert into "organizations" ("id", "name", "tax_id", "status", "vat_status", "registered_address", "path", "created_at", "updated_at")
       values (?, ?, ?, 'active', 'vat_payer', '{"street":"T 1","city":"W","postalCode":"00-001","country":"PL"}'::jsonb, ?, now(), now())`,
      [ids.org, `Conversion org ${stamp}`, `PLCONV${stamp}`, `/${ids.org}/`],
    );
    await sql(
      `insert into "categories" ("id", "name", "slug", "created_at", "updated_at") values (?, '{"en-US":"Conv"}'::jsonb, ?, now(), now())`,
      [ids.category, `conv-${stamp}`],
    );
    await product(ids.X, 'CONV-X', 'simple', { color: 'red' });
    await product(ids.W, 'CONV-W', 'simple', {});
    await product(ids.Y, 'CONV-Y', 'simple', { color: 'blue', defaultPrice: 55, price: 44 });
    await product(ids.Z, 'CONV-Z', 'configurable', {});
    await sql(
      `insert into "product_variants" ("id", "parent_product_id", "sku", "variant_attribute_values", "price_override", "created_at", "updated_at")
       values (?, ?, ?, '{"color":"red"}'::jsonb, 12, now(), now())`,
      [ids.V, ids.Z, `CONV-V-${stamp}`],
    );

    // The Default list's brackets — X in PLN (two tiers) and EUR, W in PLN —
    // and a base row W got through the new API before the conversion.
    await sql(`insert into "price_list_products" ("price_list_id", "product_id") values (?, ?), (?, ?)`, [
      DEFAULT_LIST,
      ids.X,
      DEFAULT_LIST,
      ids.W,
    ]);
    await sql(
      `insert into "price_list_price_brackets" ("price_list_id", "product_id", "currency_code", "min_quantity", "max_quantity", "amount")
       values (?, ?, 'PLN', 1, 9, 100), (?, ?, 'PLN', 10, null, 90), (?, ?, 'EUR', 1, null, 25), (?, ?, 'PLN', 1, null, 80)`,
      [DEFAULT_LIST, ids.X, DEFAULT_LIST, ids.X, DEFAULT_LIST, ids.X, DEFAULT_LIST, ids.W],
    );
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, 1, 'fixed', 70, now(), now())`,
      [DEFAULT_LIST, ids.W],
    );
    // The Default list's own old-model matrix entries (N13: not converted).
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "category_id", "min_quantity", "price_type", "discount_percent", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, 1, 'discount_percent', 10, now(), now())`,
      [DEFAULT_LIST, ids.category],
    );
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "organization_id", "min_quantity", "price_type", "amount", "currency_code", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, ?, 1, 'fixed', 65, 'PLN', now(), now())`,
      [DEFAULT_LIST, ids.X, ids.org],
    );

    // A rule-based list of the old model, with everything that hangs off it.
    await sql(
      `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                  "application_rule", "is_system", "audience_kind", "modified_at", "created_at", "updated_at")
       values (?, ?, 'Old rule list', 'PLN', false, 0, 'base', 'active', '{"kind":"all"}'::jsonb, false, 'everyone', now(), now(), now())`,
      [ids.oldList, `old-${stamp}`],
    );
    await sql(`insert into "price_list_products" ("price_list_id", "product_id") values (?, ?)`, [ids.oldList, ids.X]);
    await sql(
      `insert into "price_list_price_brackets" ("price_list_id", "product_id", "currency_code", "min_quantity", "max_quantity", "amount")
       values (?, ?, 'PLN', 1, null, 77)`,
      [ids.oldList, ids.X],
    );
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "organization_id", "min_quantity", "price_type", "amount", "currency_code", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, ?, 1, 'fixed', 60, 'PLN', now(), now())`,
      [ids.oldList, ids.X, ids.org],
    );
    await sql(
      `insert into "price_list_items" ("id", "price_list_id", "mode", "product_id", "min_quantity", "unit_price", "created_at", "updated_at")
       values (gen_random_uuid(), ?, 'fixed', ?, 1, 1, now(), now())`,
      [ids.oldList, ids.X],
    );
    await sql(
      `insert into "price_list_assignments" ("id", "price_list_id", "organization_id", "is_default", "priority", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, false, 0, now(), now())`,
      [ids.oldList, ids.org],
    );

    // An old-model list a feed is pinned to, with rows, an audience and a
    // channel: the foreign key refuses its deletion.
    await sql(
      `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                  "application_rule", "is_system", "audience_kind", "modified_at", "created_at", "updated_at")
       values (?, ?, 'Pinned old list', 'PLN', false, 0, 'base', 'active', '{"kind":"all"}'::jsonb, false, 'organizations', now(), now(), now())`,
      [ids.pinnedList, `pinned-${stamp}`],
    );
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, 1, 'fixed', 33, now(), now())`,
      [ids.pinnedList, SEED_PRODUCT_101_ID],
    );
    await sql(`insert into "price_list_audience_members" ("id", "price_list_id", "organization_id") values (gen_random_uuid(), ?, ?)`, [
      ids.pinnedList,
      ids.org,
    ]);
    await sql(`insert into "sales_channel_price_lists" ("sales_channel_id", "price_list_id") values (?, ?)`, [
      ids.channel,
      ids.pinnedList,
    ]);
    await sql(`update "product_feeds" set "price_list_id" = ? where "id" = ?`, [ids.pinnedList, feed.id]);

    // A price book written through the new API before the conversion: kept.
    await sql(
      `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                  "application_rule", "is_system", "audience_kind", "ever_activated", "modified_at", "created_at", "updated_at")
       values (?, ?, 'A price book', 'PLN', false, 0, 'regular', 'active', null, false, 'everyone', true, now(), now(), now())`,
      [ids.book, `pb-${ids.book}`],
    );
    await sql(`insert into "sales_channel_price_lists" ("sales_channel_id", "price_list_id") values (?, ?)`, [ids.channel, ids.book]);
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "category_id", "min_quantity", "price_type", "percent", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?, 1, 'percent', -5, now(), now())`,
      [ids.book, ids.category],
    );

    // ── the release's migrations, in the order `migrate` runs them
    await run(catalogMigration(), 'up');
    await run(conversion(), 'up');
    await run(feedKeyDropped(), 'up');
    await container.resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists').handle.pricingGeneration.bump();
  }, 5 * 60_000);

  afterAll(async () => {
    await sql(`delete from "product_feeds" where "id" = ?`, [feed?.id ?? '00000000-0000-4000-8000-000000000000']).catch(() => undefined);
    await sql(`delete from "price_lists" where "id" = ?`, [ids.book]).catch(() => undefined);
    await sql(`delete from "products" where "id" = any(?::uuid[])`, [`{${[ids.X, ids.W, ids.Y, ids.Z].join(',')}}`]).catch(
      () => undefined,
    );
    await sql(`delete from "categories" where "id" = ?`, [ids.category]).catch(() => undefined);
    await sql(`delete from "organizations" where "id" = ?`, [ids.org]).catch(() => undefined);
    await sql(`delete from "sales_channels" where "id" = ?`, [ids.channel]).catch(() => undefined);
    await teardownBackendServer(h);
  });

  it('every Default bracket is a row of its currency base book (FR-041)', async () => {
    expect(await baseRows(ids.X)).toEqual([
      { currency: 'EUR', min: 1, max: null, amount: '25.0000' },
      { currency: 'PLN', min: 1, max: 9, amount: '100.0000' },
      { currency: 'PLN', min: 10, max: null, amount: '90.0000' },
    ]);
    const books = await sql<{ id: string; currency_code: string; type: string; status: string; audience_kind: string }>(
      `select "id", "currency_code", "type", "status", "audience_kind" from "price_lists" where "is_system" order by "currency_code"`,
    );
    expect(books.map((b) => b.currency_code.trim())).toEqual(['EUR', 'PLN']);
    expect(books.find((b) => b.currency_code.trim() === 'PLN')!.id).toBe(DEFAULT_LIST);
    for (const book of books) expect(book).toMatchObject({ type: 'regular', status: 'active', audience_kind: 'everyone' });
  });

  it('a base row written before the conversion wins over the Default bracket it shadowed', async () => {
    expect(await baseRows(ids.W)).toEqual([{ currency: 'PLN', min: 1, max: null, amount: '70.0000' }]);
  });

  it('the catalogue fields are gone and not converted: the product and the variant they priced have no price (FR-042)', async () => {
    expect(await columns('product_variants')).not.toContain('price_override');
    const [y] = await sql<{ attribute_values: Record<string, unknown> }>(`select "attribute_values" from "products" where "id" = ?`, [
      ids.Y,
    ]);
    expect(y!.attribute_values).toEqual({ color: 'blue' });
    expect(await baseRows(ids.Y)).toEqual([]);
    expect(
      await sql(`select 1 from "price_list_matrix_entries" where "variant_id" = ? or "product_id" = ?`, [ids.V, ids.Z]),
    ).toEqual([]);
    const lines = await pricing.resolveLinePrices({
      lines: [
        { key: 'Y', product: { id: ids.Y, attributeValues: { color: 'blue' } }, quantity: 1 },
        { key: 'V', product: { id: ids.Z, attributeValues: {} }, variantId: ids.V, quantity: 1 },
        { key: 'X', product: { id: ids.X, attributeValues: { color: 'red' } }, quantity: 1 },
      ],
      context: { salesChannel: { id: ids.channel, defaultCurrency: 'PLN' } },
    });
    expect(lines.get('Y') ?? null).toBeNull();
    expect(lines.get('V') ?? null).toBeNull();
    // A product that had a price keeps it, in the currency it had it in (SC-006).
    expect(lines.get('X')?.amount).toBe('100.0000');
    const eur = await pricing.resolveLinePrices({
      lines: [{ key: 'X', product: { id: ids.X, attributeValues: { color: 'red' } }, quantity: 1 }],
      context: { salesChannel: { id: ids.channel, defaultCurrency: 'PLN' }, currencyCode: 'EUR' },
    });
    expect(eur.get('X')?.amount).toBe('25.0000');
  });

  it('an old-model list nothing refers to is deleted; the price book stays (N13)', async () => {
    const lists = await sql<{ id: string }>(`select "id" from "price_lists" where not "is_system"`);
    expect(lists.map((l) => l.id)).toContain(ids.book);
    expect(lists.map((l) => l.id)).not.toContain(ids.oldList);
    expect(await sql(`select 1 from "price_list_matrix_entries" where "price_list_id" = ?`, [ids.oldList])).toEqual([]);
    // The Default list's old-model entries went; its base rows stayed.
    const onDefault = await sql<{ category_id: string | null; product_id: string | null; amount: string | null }>(
      `select "category_id", "product_id", "amount" from "price_list_matrix_entries" where "price_list_id" = ? and "product_id" = any(?::uuid[]) or ("price_list_id" = ? and "category_id" = ?)`,
      [DEFAULT_LIST, `{${ids.X},${ids.W}}`, DEFAULT_LIST, ids.category],
    );
    expect(onDefault.map((r) => Number(r.amount).toFixed(2)).sort()).toEqual(['100.00', '70.00', '90.00']);
    const [book] = await sql<{ n: string }>(`select count(*) as "n" from "price_list_matrix_entries" where "price_list_id" = ?`, [
      ids.book,
    ]);
    expect(book!.n).toBe('1');
  });

  it('an old-model list a feed is pinned to is retired, not deleted, and the upgrade completes (R4)', async () => {
    const [retired] = await sql<{ name: string; status: string; audience_kind: string; type: string; is_system: boolean }>(
      `select "name", "status", "audience_kind", "type", "is_system" from "price_lists" where "id" = ?`,
      [ids.pinnedList],
    );
    expect(retired).toEqual({
      name: `Pinned old list${RETIRED_SUFFIX}`,
      status: 'expired',
      audience_kind: 'everyone',
      type: 'regular',
      is_system: false,
    });
    expect(await sql(`select 1 from "price_list_matrix_entries" where "price_list_id" = ?`, [ids.pinnedList])).toEqual([]);
    expect(await sql(`select 1 from "price_list_audience_members" where "price_list_id" = ?`, [ids.pinnedList])).toEqual([]);
    expect(await sql(`select 1 from "sales_channel_price_lists" where "price_list_id" = ?`, [ids.pinnedList])).toEqual([]);
    expect(await sql(`select 1 from "price_list_product_lines" where "price_list_id" = ?`, [ids.pinnedList])).toEqual([]);
    expect(
      await sql(`select 1 from pg_constraint where "conname" = 'product_feeds_price_list_fk'`),
      'product_feeds drops its key into price_lists',
    ).toEqual([]);
  });

  it('the feed pinned to the retired list warns, and its next run withdraws the file; deleting the book leaves it not_found', async () => {
    const [pin] = await sql<{ price_list_id: string | null }>(`select "price_list_id" from "product_feeds" where "id" = ?`, [feed.id]);
    expect(pin!.price_list_id).toBe(ids.pinnedList);
    expect(await feedWarning(feed.id)).toBe('not_active');

    const withdrawn = await generate(feed.id);
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.withdrawalReason).toBe('not_active');
    expect(await publicStatus(feed.token)).toBe(404);

    const deleted = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/price-books/${ids.pinnedList}`, ...ADMIN });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect(await feedWarning(feed.id)).toBe('not_found');
    const again = await generate(feed.id);
    expect(again.status).toBe('withdrawn');
    expect(again.withdrawalReason).toBe('not_found');
  });

  it('the old storage is gone (FR-042)', async () => {
    const tables = (
      await sql<{ table_name: string }>(
        `select "table_name" from information_schema.tables
          where "table_schema" = 'public' and "table_name" = any(?::text[])`,
        ['{price_list_products,price_list_price_brackets,price_list_items,price_list_assignments}'],
      )
    ).map((t) => t.table_name);
    expect(tables).toEqual([]);
    const header = await columns('price_lists');
    for (const gone of ['application_rule', 'code', 'is_default', 'modified_at']) expect(header).not.toContain(gone);
    const rows = await columns('price_list_matrix_entries');
    for (const gone of ['organization_id', 'currency_code', 'discount_percent']) expect(rows).not.toContain(gone);
    expect(await sql(`select 1 from "price_lists" where "type" not in ('regular', 'sale')`)).toEqual([]);
  });

  it('the type and price CHECKs admit only the price-book shapes', async () => {
    await expect(
      sql(
        `insert into "price_list_matrix_entries" ("id", "price_list_id", "category_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, 1, 'discount_percent', null, now(), now())`,
        [ids.book, ids.category],
      ),
    ).rejects.toThrow();
    await expect(sql(`update "price_lists" set "type" = 'base' where "id" = ?`, [ids.book])).rejects.toThrow();
  });

  it('precedence v1 is HY and active', async () => {
    const [v1] = await sql<{ state: string; cells: string[] }>(
      `select "state", "cells" from "price_list_precedence" where "version" = 1`,
    );
    expect(v1!.state).toBe('active');
    expect(v1!.cells[0]).toBe('org.variant');
    expect(v1!.cells.at(-1)).toBe('group.all');
  });
});
