import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-029) — a product feed pinned to a named price book reads that
 * book's rows over the catalogue price of the feed's channel and currency;
 * products the book does not price are absent from the feed, as before. The
 * read is `pricingService.namedListPrices` on the price-book engine.
 *
 * Owner ruling 2026-10-23 — a pinned feed publishes the book's prices only
 * while the book would price an anonymous buyer on the feed's channel now: it
 * is `active` or `scheduled` and inside its schedule window, bound to the
 * feed's channel (the base book is channel-independent), and its audience is
 * everyone. Otherwise the feed gets no prices from it, and the admin's feed
 * row names why (`pinnedPriceBookWarning`). The catalogue price a pinned
 * everyone book's percentages are taken off is the channel's catalogue price
 * without that book.
 */
describe('product feeds — a feed pinned to a price book', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const DAY = 86_400_000;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const read = (priceListId: string) =>
    f.pricing.namedListPrices({
      priceListId,
      currencyCode: 'PLN',
      salesChannelId: f.channels.CH1.id,
      productIds: [f.products.P1.id, f.products.P2.id, f.products.P3.id],
    });
  const publishability = (priceListId: string, currencyCode = 'PLN') =>
    f.pricing.namedListPublishability({ priceListId, currencyCode, salesChannelId: f.channels.CH1.id });

  it('the book’s rows over the catalogue price without it; what it does not price is absent', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '120' }] });
    const pinned = await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, percent: '-10' }] });
    const prices = await read(pinned.id);
    // P1: catalogue 120 (the other book) −10 %; P2: base 50 −10 %; P3 is a bolt — not priced by the book.
    expect(Object.fromEntries(prices)).toEqual({
      [f.products.P1.id]: '108.0000',
      [f.products.P2.id]: '45.0000',
    });
    expect(await publishability(pinned.id)).toEqual({ publishable: true });
  });

  it('a feed pinned to the base book reads the base prices', async () => {
    const [base] = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "price_lists" where "is_system" = true and "currency_code" = 'PLN'`);
    const prices = await read(base!.id);
    expect(Object.fromEntries(prices)).toEqual({
      [f.products.P1.id]: '100.0000',
      [f.products.P2.id]: '50.0000',
      [f.products.P3.id]: '30.0000',
    });
    expect(await publishability(base!.id)).toEqual({ publishable: true });
  });

  it('a book that does not apply now publishes nothing, and says why', async () => {
    const rows = [{ product: f.products.P1, fixed: '77' }];
    const cases: Array<[string, Promise<{ id: string }>, string]> = [
      ['draft', f.book({ audience: 'everyone', rows, activate: false }), 'not_active'],
      ['starts tomorrow', f.book({ audience: 'everyone', rows, startsAt: new Date(Date.now() + DAY) }), 'outside_schedule'],
      [
        'ended yesterday, not yet swept',
        f.book({ audience: 'everyone', rows, startsAt: new Date(Date.now() - 2 * DAY) }).then(async (b) => {
          await h.em().getConnection().execute(`update "price_lists" set "ends_at" = now() - interval '1 day' where "id" = ?`, [b.id]);
          return b;
        }),
        'outside_schedule',
      ],
      [
        'expired',
        f.book({ audience: 'everyone', rows }).then(async (b) => {
          await h.em().getConnection().execute(`update "price_lists" set "status" = 'expired' where "id" = ?`, [b.id]);
          return b;
        }),
        'not_active',
      ],
      ['bound to another channel', f.book({ audience: 'everyone', rows, channels: [f.channels.CH2] }), 'not_on_channel'],
      ['for one organization', f.book({ audience: { organizations: [f.orgs.Acme] }, rows }), 'audience_restricted'],
      ['for a customer group', f.book({ audience: { groups: [f.groups.VIP] }, rows }), 'audience_restricted'],
    ];
    for (const [label, created, reason] of cases) {
      const book = await created;
      expect(Object.fromEntries(await read(book.id)), label).toEqual({});
      expect(await publishability(book.id), label).toEqual({ publishable: false, reason });
    }
  });

  it('a book in another currency, or none at all, publishes nothing', async () => {
    const eur = await f.book({ audience: 'everyone', currency: 'EUR', channels: [f.channels.CH2], rows: [{ product: f.products.P1, fixed: '9' }] });
    expect(await publishability(eur.id)).toEqual({ publishable: false, reason: 'currency_mismatch' });
    expect(await publishability('00000000-0000-4000-8000-0000000000ff')).toEqual({ publishable: false, reason: 'not_found' });
  });

  describe('the admin feed row names a pinned book that publishes nothing', () => {
    const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
    let templateId: string;

    // The feeds hold their book (`product_feeds_price_list_fk`): go before the books do.
    afterEach(async () => {
      await h.em().getConnection().execute(`delete from "product_feeds" where "name" = 'Pinned feed'`);
    });

    beforeAll(async () => {
      const templates = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', ...ADMIN });
      expect(templates.statusCode).toBe(200);
      templateId = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> }).data.find(
        (t) => t.systemCode === 'google_merchant_v1',
      )!.id;
    });

    const feedPinnedTo = async (priceListId: string | null) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: {
          name: 'Pinned feed',
          slug: `pinned-${Math.random().toString(36).slice(2, 10)}`,
          feedTemplateId: templateId,
          salesChannelId: f.channels.CH1.id,
          languageCode: 'pl-PL',
          currencyCode: 'PLN',
          pricePresentation: 'net',
          priceListId,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
    };
    const warningOf = async (feedId: string) => {
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/product-feeds/${feedId}`, ...ADMIN });
      expect(detail.statusCode, detail.body).toBe(200);
      const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/product-feeds', ...ADMIN });
      const row = (list.json() as { data: Array<{ id: string; pinnedPriceBookWarning: string | null }> }).data.find((r) => r.id === feedId);
      const fromDetail = (detail.json() as { data: { feed?: { pinnedPriceBookWarning: string | null }; pinnedPriceBookWarning?: string | null } }).data;
      return { detail: fromDetail.feed?.pinnedPriceBookWarning ?? fromDetail.pinnedPriceBookWarning ?? null, list: row?.pinnedPriceBookWarning ?? null };
    };

    it('null for an unpinned feed and for a book that publishes; the reason otherwise', async () => {
      const live = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '77' }] });
      const draft = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '77' }], activate: false });
      const acme = await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, fixed: '77' }] });
      expect(await warningOf(await feedPinnedTo(null))).toEqual({ detail: null, list: null });
      expect(await warningOf(await feedPinnedTo(live.id))).toEqual({ detail: null, list: null });
      expect(await warningOf(await feedPinnedTo(draft.id))).toEqual({ detail: 'not_active', list: 'not_active' });
      expect(await warningOf(await feedPinnedTo(acme.id))).toEqual({ detail: 'audience_restricted', list: 'audience_restricted' });
    });
  });
});
