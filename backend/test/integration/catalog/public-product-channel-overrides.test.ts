import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  type CatalogProductAvailabilityPort,
  type CatalogProductReadPort,
  type ListingPriceDetailPort,
} from '@endora-commerce/contracts';
import { SearchQueryService } from '../../../../packages/modules/search/dist/backend/services/search-query.service.js';

import { seedScopedValues } from '../../helpers/scoped-values.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #384 — the storefront product page and the listing cards show a
 * product's effective name, description and channel-scoped attribute values
 * for the request's (sales channel, language), resolved through the same
 * resolver the admin scope editor previews with and the search indexer
 * indexes with.
 *
 * Before the fix both reads walked only the language fallback over the
 * baseline JSONB, so a channel override written in the scope editor was
 * visible in admin and in the search index but nowhere on the product page or
 * the listing.
 *
 * Seeds one product on `pl_retail` and `pl_b2b_vip`, writes a
 * (`pl_b2b_vip`, `pl-PL`) override for Name and Description and a
 * `pl_b2b_vip` channel-only override for a channel-scoped user attribute, then
 * reads the public product page and the public listing on both channels.
 */
describe('Issue #384 — public product reads honour channel value overrides', () => {
  let h: BackendServerHandle;
  let productId: string;
  let slug: string;
  let attributeKey: string;
  let groupedSlug: string;
  let bundleSlug: string;
  let createdSince: string;
  let retailChannelId: string;
  let vipChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Listing reads below narrow by `changedSince` so the page holds only the
    // products this file creates.
    createdSince = new Date(Date.now() - 1000).toISOString();

    attributeKey = `finish_${Date.now()}`;
    const attr = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: attributeKey,
        label: { 'en-US': 'Finish', 'pl-PL': 'Wykończenie' },
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        isVisibleOnProductPage: true,
        scopable: true,
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(attr.statusCode, attr.body).toBe(201);

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `OVR-384-${Date.now()}`,
        type: 'simple',
        name: 'Zestaw bazowy',
        description: 'Opis bazowy',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const data = (created.json() as { data: { id: string; slug: string } }).data;
    productId = data.id;
    slug = data.slug;

    const grouped = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `OVR-384-GRP-${Date.now()}`,
        type: 'grouped',
        name: 'Grupa',
        description: 'Grupa',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(grouped.statusCode, grouped.body).toBe(201);
    const groupedData = (grouped.json() as { data: { id: string; slug: string } }).data;
    groupedSlug = groupedData.slug;

    const bundle = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `OVR-384-BDL-${Date.now()}`,
        type: 'bundle',
        name: 'Pakiet',
        description: 'Pakiet',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(bundle.statusCode, bundle.body).toBe(201);
    const bundleData = (bundle.json() as { data: { id: string; slug: string } }).data;
    bundleSlug = bundleData.slug;

    const conn = h.em().getConnection();
    const rows = await conn.execute<Array<{ id: string; code: string }>>(
      `select id, code from sales_channels where code in ('pl_retail', 'pl_b2b_vip')`,
      [],
      'all',
    );
    retailChannelId = rows.find((r) => r.code === 'pl_retail')!.id;
    vipChannelId = rows.find((r) => r.code === 'pl_b2b_vip')!.id;
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id)
       values (?,?), (?,?), (?,?), (?,?), (?,?), (?,?)
       on conflict do nothing`,
      [
        retailChannelId,
        productId,
        vipChannelId,
        productId,
        retailChannelId,
        groupedData.id,
        vipChannelId,
        groupedData.id,
        retailChannelId,
        bundleData.id,
        vipChannelId,
        bundleData.id,
      ],
    );
    // The attribute's baseline goes straight onto the row: the create route
    // refuses a value for an attribute outside the product's attribute set,
    // and the set is not what this file is about.
    await conn.execute(
      `update products set attribute_values = jsonb_build_object(?::text, 'Gloss') where id = ?`,
      [attributeKey, productId],
    );
    // `de-DE` is a channel language with no baseline text on the product, so a
    // `de-DE` request falls through to the channel default `pl-PL`, pinned here
    // rather than assumed from the fixture.
    await conn.execute(
      `update sales_channels
          set languages = '["pl-PL","en-US","de-DE"]'::jsonb, default_language = 'pl-PL'
        where id in (?, ?)`,
      [retailChannelId, vipChannelId],
    );
    await conn.execute(
      `insert into grouped_items
         (id, parent_product_id, child_product_id, position, quantity, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 0, 1, now(), now())`,
      [groupedData.id, productId],
    );
    await conn.execute(
      `insert into product_links
         (id, source_product_id, target_product_id, kind, position, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 'related', 0, now(), now())`,
      [groupedData.id, productId],
    );

    const slotId = (
      await conn.execute<Array<{ id: string }>>(
        `insert into bundle_slots
           (id, parent_product_id, name, min_quantity, max_quantity, position, created_at, updated_at)
         values (gen_random_uuid(), ?, '{"pl-PL":"Zestaw","en-US":"Kit"}'::jsonb, 0, 1, 0, now(), now())
         returning id`,
        [bundleData.id],
        'all',
      )
    )[0]!.id;
    await conn.execute(
      `insert into bundle_slot_options
         (id, slot_id, option_product_id, default_quantity, position, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 1, 0, now(), now())`,
      [slotId, productId],
    );

    // Feature 172 (T043) — seeded as stored (the 163 value-overrides PATCH is retired).
    await seedScopedValues(h.em().fork(), productId, [
      { field: 'name', scope: { level: 'channel_language', channelId: vipChannelId, languageCode: 'pl-PL' }, value: 'Zestaw hurtowy' },
      { field: 'description', scope: { level: 'channel_language', channelId: vipChannelId, languageCode: 'pl-PL' }, value: 'Opis hurtowy' },
      { field: `attribute:${attributeKey}`, scope: { level: 'channel', channelId: vipChannelId }, value: 'Matte' },
    ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  type Detail = {
    name: string;
    description: string;
    attributeValues: Record<string, unknown>;
    visibleAttributes: Array<{ key: string; valueRendered: string }>;
    seo: { metaTitle: string };
  };

  /** `language: null` sends no `Accept-Language` — the channel default leg. */
  async function readDetail(channel: string, language: string | null): Promise<Detail> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${slug}`,
      headers: {
        'x-sales-channel': channel,
        ...(language !== null ? { 'accept-language': language } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Detail }).data;
  }

  async function readCardName(channel: string, language: string | null): Promise<string | undefined> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?limit=100&changedSince=${encodeURIComponent(createdSince)}`,
      headers: {
        'x-sales-channel': channel,
        ...(language !== null ? { 'accept-language': language } : {}),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cards = (res.json() as { data: Array<{ id: string; name: string }> }).data;
    return cards.find((c) => c.id === productId)?.name;
  }

  it('the product page on the overridden (channel, language) shows the override', async () => {
    const detail = await readDetail('pl_b2b_vip', 'pl-PL');
    expect(detail.name).toBe('Zestaw hurtowy');
    expect(detail.description).toBe('Opis hurtowy');
    expect(detail.seo.metaTitle).toBe('Zestaw hurtowy');
    expect(detail.attributeValues[attributeKey]).toBe('Matte');
    expect(detail.visibleAttributes.find((a) => a.key === attributeKey)?.valueRendered).toBe(
      'Matte',
    );
  });

  it('the product page on another channel shows the baseline', async () => {
    const detail = await readDetail('pl_retail', 'pl-PL');
    expect(detail.name).toBe('Zestaw bazowy');
    expect(detail.description).toBe('Opis bazowy');
    expect(detail.attributeValues[attributeKey]).toBe('Gloss');
    expect(detail.visibleAttributes.find((a) => a.key === attributeKey)?.valueRendered).toBe(
      'Gloss',
    );
  });

  // Feature 172 (FR-013, FR-014): one Global text; a language of the channel without its own
  // override shows it (C×L → C → G), and the channel-only attribute override.
  it('the product page in another language of the same channel shows the Global text, and the channel-only attribute override', async () => {
    const detail = await readDetail('pl_b2b_vip', 'en-US');
    expect(detail.name).toBe('Zestaw bazowy');
    expect(detail.description).toBe('Opis bazowy');
    expect(detail.attributeValues[attributeKey]).toBe('Matte');
  });

  it('with no Accept-Language the channel default language picks the (channel, language) override', async () => {
    const detail = await readDetail('pl_b2b_vip', null);
    expect(detail.name).toBe('Zestaw hurtowy');
    expect(detail.description).toBe('Opis hurtowy');
    expect(await readCardName('pl_b2b_vip', null)).toBe('Zestaw hurtowy');
    expect((await readDetail('pl_retail', null)).name).toBe('Zestaw bazowy');
  });

  it('an offered language with no override of its own shows the Global text, never another language\'s override (feature 172)', async () => {
    // `de-DE` is a language of the channel: its scope is (channel, de-DE), which holds no row, so
    // the chain reaches the Global value — the (channel, pl-PL) override is another scope's.
    const detail = await readDetail('pl_b2b_vip', 'de-DE');
    expect(detail.name).toBe('Zestaw bazowy');
    expect(detail.description).toBe('Opis bazowy');
    expect(await readCardName('pl_b2b_vip', 'de-DE')).toBe('Zestaw bazowy');
    expect((await readDetail('pl_retail', 'de-DE')).name).toBe('Zestaw bazowy');
  });

  it('a bundle lists its slot option under the option effective name', async () => {
    const read = async (channel: string): Promise<string | undefined> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${bundleSlug}`,
        headers: { 'x-sales-channel': channel, 'accept-language': 'pl-PL' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: {
          bundleSlots?: Array<{ options: Array<{ product: { id: string; name: string } }> }>;
        };
      };
      return body.data.bundleSlots
        ?.flatMap((s) => s.options)
        .find((o) => o.product.id === productId)?.product.name;
    };
    expect(await read('pl_b2b_vip')).toBe('Zestaw hurtowy');
    expect(await read('pl_retail')).toBe('Zestaw bazowy');
  });

  it('the listing card follows the same resolution', async () => {
    expect(await readCardName('pl_b2b_vip', 'pl-PL')).toBe('Zestaw hurtowy');
    expect(await readCardName('pl_retail', 'pl-PL')).toBe('Zestaw bazowy');
    expect(await readCardName('pl_b2b_vip', 'en-US')).toBe('Zestaw bazowy');
  });

  it('a grouped parent lists its child, and its related link, under the child effective name', async () => {
    const read = async (
      channel: string,
    ): Promise<{ child: string | undefined; related: string | undefined }> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${groupedSlug}`,
        headers: { 'x-sales-channel': channel, 'accept-language': 'pl-PL' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: {
          groupedItems?: Array<{ product: { id: string; name: string } }>;
          links?: { related: Array<{ product: { id: string; name: string } }> };
        };
      };
      return {
        child: body.data.groupedItems?.find((i) => i.product.id === productId)?.product.name,
        related: body.data.links?.related.find((l) => l.product.id === productId)?.product.name,
      };
    };
    expect(await read('pl_b2b_vip')).toEqual({ child: 'Zestaw hurtowy', related: 'Zestaw hurtowy' });
    expect(await read('pl_retail')).toEqual({ child: 'Zestaw bazowy', related: 'Zestaw bazowy' });
  });

  it('a related tile shows the name the catalogue card shows at the same (channel, language)', async () => {
    // Feature 172: the tile resolves at the request's (C, L) — no request language is the channel
    // default's — like the card (163's own language pick, with no channel-default leg, is gone).
    const relatedName = async (language: string | null): Promise<string | undefined> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${groupedSlug}/links?kind=related`,
        headers: {
          'x-sales-channel': 'pl_b2b_vip',
          ...(language !== null ? { 'accept-language': language } : {}),
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const rows = (res.json() as { data: Array<{ product: { id: string; name: string } }> })
        .data;
      return rows.find((l) => l.product.id === productId)?.product.name;
    };
    for (const language of [null, 'pl-PL', 'de-DE']) {
      expect(await relatedName(language), String(language)).toBe(await readCardName('pl_b2b_vip', language));
    }
  });

  it('a search result card shows the name the listing card shows, for every channel and language', async () => {
    // The hydration step of the Meilisearch path, driven with a hit the way
    // the engine returns it, so the case needs no search engine. The hit's
    // indexed name is deliberately neither text: the card must not trust it.
    const search = new SearchQueryService(
      h.container.resolve<CatalogProductReadPort>('catalogProductReadPort'),
      undefined,
      {},
      // Names are this case's subject, not prices: the pricing port resolves nothing.
      { resolveListingPriceDetails: async () => new Map() } as unknown as ListingPriceDetailPort,
      undefined,
      // Feature 163 — hydration asks `catalog` for every hit.
      h.container.resolve<CatalogProductAvailabilityPort>('catalogProductAvailabilityPort'),
    );
    const searchCardName = async (
      channelId: string,
      code: string,
      language: string | null,
    ): Promise<string | undefined> => {
      const [card] = await search.hydrateHits(
        [
          {
            id: productId,
            sku: 'unused',
            slug,
            type: 'simple',
            categorySlugs: [],
            primaryAssetUrl: null,
          },
        ],
        {
          resolvedChannel: {
            id: channelId,
            code,
            defaultCurrency: 'PLN',
            defaultLanguage: 'pl-PL',
            // The channels' languages, as the request's resolved channel carries them.
            languages: ['pl-PL', 'en-US', 'de-DE'],
          },
          audience: ANONYMOUS_PRODUCT_AUDIENCE,
          preferredLanguage: language ?? undefined,
        },
      );
      return card?.name;
    };
    for (const [channelId, code] of [
      [vipChannelId, 'pl_b2b_vip'],
      [retailChannelId, 'pl_retail'],
    ] as const) {
      for (const language of ['pl-PL', 'en-US', 'de-DE', null]) {
        expect(await searchCardName(channelId, code, language), `${code} ${language}`).toBe(
          await readCardName(code, language),
        );
      }
    }
    expect(await searchCardName(vipChannelId, 'pl_b2b_vip', 'pl-PL')).toBe('Zestaw hurtowy');
    expect(await searchCardName(retailChannelId, 'pl_retail', 'pl-PL')).toBe('Zestaw bazowy');
  });
});
