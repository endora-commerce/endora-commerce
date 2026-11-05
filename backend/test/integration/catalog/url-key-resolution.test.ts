import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  productKeyResolutionSchema,
  productPath,
  type ProductKeyResolution,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { errorBodyOf, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 17 (T107), on feature 174's keys (T047; `specs/174-product-editor-scope-switcher/
 * contracts/url-keys.md` §4: a key is a Global slug, a Channel key or a Channel × language key; 163's
 * language key of L is written here as the C×L key of L in each channel) — resolving a storefront
 * key at (C, L)
 * (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md` §4,
 * data-model §5 "Resolution order", research R12, R28; FR-071, FR-072, US7 #1,
 * #3, #8, #11; re-analyze H1).
 *
 * `GET /api/v1/catalog/products/resolve/:key` answers `kind: 'product'` for the
 * product's effective key at (C, L), `kind: 'redirect'` (HTTP 200) for any other
 * of its current keys in L and for its redirect keys in L — always to the path
 * `productPath()` builds for the effective key — and one not-found for a key of
 * another language (K1), a key of no product, and a product unavailable to the
 * caller at (C, L). A redirect never discloses an unavailable product: it is
 * checked before the answer, and answers the absent key's body.
 *
 * Keys are written through the admin PUT (the Command of Phase 16); the channel
 * pair is this suite's own, both offering `en-US` (default) and `pl-PL`.
 */
/** Every channel this file inserts: en-US default, pl-PL, created after feature 167's migration (prefixed). */
const CHANNEL_URL_FACTS = { languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US', prefixDefaultLanguage: true };

describe('URL-key resolution at (C, L) (spec 163, T107)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const buyer = { cookies: { b2b_session: 'stub-customer-session' } };
  const channels: Array<{ id: string; code: string }> = [];
  const products: string[] = [];
  let c1: { id: string; code: string };
  let c2: { id: string; code: string };

  const k = (base: string): string => `${base}-${run}`;

  async function sql(query: string, params: unknown[] = []): Promise<void> {
    await h.em().getConnection().execute(query, params);
  }

  async function insertChannel(label: string): Promise<{ id: string; code: string }> {
    const id = randomUUID();
    const code = `r163-${run}-${label}`;
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `163 resolve ${label}` })],
    );
    await sql(
      `insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?) on conflict do nothing`,
      [id, TEST_ORGANIZATION_ID],
    );
    const channel = { id, code };
    channels.push(channel);
    return channel;
  }

  async function insertProduct(
    slug: string,
    fields: { archived?: boolean; restrictedTo?: string[] } = {},
  ): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, visibility, allowed_organization_ids,
                             archived_at, created_at, updated_at)
       values (?, ?, ?, 'simple', ?, ?, null, ?, ?::jsonb, ?, now(), now())`,
      [
        id,
        `R163-${run}-${products.length}`,
        slug,
        fields.archived ? 'inactive' : 'active',
        `Resolve ${slug}`,
        fields.restrictedTo ? 'organization_restricted' : 'public',
        JSON.stringify(fields.restrictedTo ?? []),
        fields.archived ? new Date() : null,
      ],
    );
    for (const channel of [c1, c2]) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel.id, id]);
    }
    products.push(id);
    return id;
  }

  /** Feature 174 — 163's language key of L is the C×L key of L in each of this file's channels. */
  const inBoth = (languageCode: string, key: string) => [
    { channelId: c1.id, languageCode, key },
    { channelId: c2.id, languageCode, key },
  ];

  async function putKeys(productId: string, payload: unknown): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/url-keys`,
      ...admin,
      payload: payload as object,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  function resolveRaw(key: string, channel: { code: string }, language: string, who: object = {}) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/resolve/${encodeURIComponent(key)}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': language },
      ...who,
    });
  }

  async function resolve(key: string, channel: { code: string }, language: string): Promise<ProductKeyResolution> {
    const res = await resolveRaw(key, channel, language);
    expect(res.statusCode, `${key} at ${channel.code}/${language}: ${res.body}`).toBe(200);
    return productKeyResolutionSchema.parse((res.json() as { data: unknown }).data);
  }

  async function expectServed(key: string, channel: { code: string }, language: string, productId: string): Promise<void> {
    expect(await resolve(key, channel, language)).toEqual({ kind: 'product', productId, key });
  }

  async function expectRedirect(key: string, channel: { code: string }, language: string, to: string): Promise<void> {
    expect(await resolve(key, channel, language)).toEqual({
      kind: 'redirect',
      key: to,
      languageCode: language,
      // The target is the one helper's answer — channels default to en-US here and,
      // created after feature 167's migration, prefix it.
      path: productPath({ key: to, languageCode: language, channel: CHANNEL_URL_FACTS }),
      // A former key, or another current key of L: a property of the URL (308).
      permanent: true,
    });
  }

  async function expectCrossLanguageRedirect(
    key: string,
    channel: { code: string },
    language: string,
    to: string,
  ): Promise<void> {
    expect(await resolve(key, channel, language)).toEqual({
      kind: 'redirect',
      key: to,
      languageCode: language,
      path: productPath({ key: to, languageCode: language, channel: CHANNEL_URL_FACTS }),
      // A current key of another language can change hands: answered 307.
      permanent: false,
    });
  }

  /**
   * The body a key nobody holds answers at this channel, in this language, for this
   * caller — the message is localised to the request language, so the reference
   * is fetched with exactly the probe's request.
   */
  async function absentBody(channel: { code: string }, language: string, who: object = {}): Promise<unknown> {
    const absent = await resolveRaw(k('nobody-holds-this'), channel, language, who);
    expect(absent.statusCode).toBe(404);
    expect((absent.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    return errorBodyOf(absent);
  }

  async function expectAbsent(key: string, channel: { code: string }, language: string, who: object = {}): Promise<void> {
    const res = await resolveRaw(key, channel, language, who);
    expect(res.statusCode, `${key} at ${channel.code}/${language}: ${res.body}`).toBe(404);
    expect(errorBodyOf(res)).toEqual(await absentBody(channel, language, who));
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    c1 = await insertChannel('c1');
    c2 = await insertChannel('c2');
  });

  afterAll(async () => {
    if (h) {
      if (products.length > 0) {
        const list = products.map(() => '?').join(',');
        await sql(`delete from product_channel_language_scopes where product_id in (${list})`, products);
        await sql(`delete from product_channel_scopes where product_id in (${list})`, products);
        await sql(`delete from sales_channel_products where product_id in (${list})`, products);
        await sql(`delete from products where id in (${list})`, products);
      }
      for (const channel of channels) {
        await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channel.id]);
        await sql(`delete from sales_channels where id = ?`, [channel.id]);
      }
      await teardownBackendServer(h);
    }
  });

  it('serves the effective key; the global key, still a key of the channel, redirects temporarily in L (US7 #1, #8; K1)', async () => {
    const p = await insertProduct(k('drill'));
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('wiertarka')) });

    await expectServed(k('wiertarka'), c1, 'pl-PL', p);
    // The global key keeps serving every language without a language key.
    await expectServed(k('drill'), c1, 'en-US', p);
    // Feature 174 (`url-keys.md` §3): the global key is still one of the product's keys in each
    // channel (en-US has no key of its own), so no redirect row is written; in pl-PL it answers the
    // temporary redirect of a key of another channel language.
    await expectCrossLanguageRedirect(k('drill'), c1, 'pl-PL', k('wiertarka'));
    await expectCrossLanguageRedirect(k('drill'), c2, 'pl-PL', k('wiertarka'));
    // A key the product holds only in pl-PL is not a key of en-US (K1): the page is
    // never rendered under it — feature 167 (FR-024) answers a temporary redirect to
    // the product's own en-US key instead.
    await expectCrossLanguageRedirect(k('wiertarka'), c1, 'en-US', k('drill'));
  });

  // -- Feature 167 (FR-024, research R-9): a key of another channel language ----

  it('redirects (not permanently) a current key of another channel language to the key of L', async () => {
    const p = await insertProduct(k('grinder'));
    await putKeys(p, {
      channelKeys: [...inBoth('pl-PL', k('szlifierka')), ...inBoth('en-US', k('angle-grinder'))],
    });
    await expectCrossLanguageRedirect(k('szlifierka'), c1, 'en-US', k('angle-grinder'));
    await expectCrossLanguageRedirect(k('angle-grinder'), c2, 'pl-PL', k('szlifierka'));
  });

  it('answers not-found when the product is not reachable in L', async () => {
    const p = await insertProduct(k('sander'));
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('szlifierka-tasmowa')) });
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [p, c1.id],
    );
    try {
      await expectAbsent(k('szlifierka-tasmowa'), c1, 'en-US');
    } finally {
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [p]);
    }
  });

  it('does not consider a key of a language the channel does not serve (XII)', async () => {
    const p = await insertProduct(k('planer'));
    // Written directly: the test dictionary seeds no de-DE, and the point is a key row
    // of a language outside the channel's list.
    await sql(
      `insert into product_url_keys (id, product_id, language_code, sales_channel_id, key, created_at, updated_at)
       values (gen_random_uuid(), ?, 'de-DE', ?, ?, now(), now())`,
      [p, c1.id, k('hobel')],
    );
    try {
      await expectAbsent(k('hobel'), c1, 'en-US');
    } finally {
      await sql(`delete from product_url_keys where product_id = ? and language_code = 'de-DE'`, [p]);
    }
  });

  it('a C\u00d7L key is a key of its channel only: another channel answers not-found (FR-016)', async () => {
    const p = await insertProduct(k('saw'));
    await putKeys(p, {
      channelKeys: [
        { channelId: c2.id, languageCode: 'pl-PL', key: k('pila') },
        { channelId: c1.id, languageCode: 'pl-PL', key: k('pila-c1') },
      ],
    });
    await expectServed(k('pila-c1'), c1, 'pl-PL', p);
    await expectServed(k('pila'), c2, 'pl-PL', p);
    await expectAbsent(k('pila'), c1, 'pl-PL');
    await expectAbsent(k('pila-c1'), c2, 'pl-PL');
  });

  it('redirects an old key at every (C, L) of its language, straight to the current key (US7 #3, #4)', async () => {
    const p = await insertProduct(k('hammer'));
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('mlotek-1')) });
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('mlotek-2')) });
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('mlotek-3')) });

    for (const channel of [c1, c2]) {
      await expectRedirect(k('mlotek-1'), channel, 'pl-PL', k('mlotek-3'));
      await expectRedirect(k('mlotek-2'), channel, 'pl-PL', k('mlotek-3'));
      await expectServed(k('mlotek-3'), channel, 'pl-PL', p);
    }
    // An L redirect is not a key of another language.
    await expectAbsent(k('mlotek-1'), c1, 'en-US');
  });

  it('answers the absent body, never a redirect, for a product unavailable at (C, L)', async () => {
    const p = await insertProduct(k('level'));
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('poziomica-1')) });
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('poziomica-2')) });

    await setChannelStatus(h.em(), p, [c2.id], 'inactive');
    try {
      await expectServed(k('poziomica-2'), c1, 'pl-PL', p);
      await expectAbsent(k('poziomica-2'), c2, 'pl-PL');
      // The old key does not redirect to it either (security carry 1).
      await expectAbsent(k('poziomica-1'), c2, 'pl-PL');
      await expectAbsent(k('level'), c2, 'en-US');
    } finally {
      await setChannelStatus(h.em(), p, [c2.id], null);
    }
  });

  it('answers the absent body to a caller outside the audience, for current and redirect keys alike', async () => {
    const p = await insertProduct(k('restricted'), { restrictedTo: [TEST_ORGANIZATION_ID] });
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('zastrzezony')) });

    // The organisation's buyer reaches it — the audience comes from the session.
    const asBuyer = await resolveRaw(k('zastrzezony'), c1, 'pl-PL', buyer);
    expect(asBuyer.statusCode, asBuyer.body).toBe(200);
    expect(asBuyer.headers['cache-control']).toBe('private, no-store');
    const viaRedirect = await resolveRaw(k('restricted'), c1, 'pl-PL', buyer);
    expect(viaRedirect.statusCode, viaRedirect.body).toBe(200);
    expect((viaRedirect.json() as { data: ProductKeyResolution }).data.kind).toBe('redirect');

    // Anonymous: neither the key nor its redirect discloses the product.
    await expectAbsent(k('zastrzezony'), c1, 'pl-PL');
    await expectAbsent(k('restricted'), c1, 'pl-PL');
    await expectAbsent(k('restricted'), c1, 'en-US');
  });

  it('answers 410 for an archived product reached by its current key or a redirect', async () => {
    const p = await insertProduct(k('archived'));
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('archiwalny')) });
    await sql(`update products set status = 'inactive', archived_at = now() where id = ?`, [p]);

    for (const [key, language] of [
      [k('archiwalny'), 'pl-PL'],
      [k('archived'), 'en-US'],
      [k('archived'), 'pl-PL'],
    ] as const) {
      const res = await resolveRaw(key, c1, language);
      expect(res.statusCode, `${key} ${language}: ${res.body}`).toBe(410);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
    }
  });

  it('T156s/T156t: an `inactive` product that is not archived answers the absent 404, by key and by id', async () => {
    const p = await insertProduct(k('inactive-only'));
    await sql(`update products set status = 'inactive', archived_at = null where id = ?`, [p]);
    await expectAbsent(k('inactive-only'), c1, 'en-US');
    const byId = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${p}`,
      headers: { 'x-sales-channel': c1.code, 'accept-language': 'en-US' },
    });
    expect(byId.statusCode, byId.body).toBe(404);
    // The PDP read of an absent product answers the same body as the resolution's.
    const absentById = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${randomUUID()}`,
      headers: { 'x-sales-channel': c1.code, 'accept-language': 'en-US' },
    });
    expect(absentById.statusCode).toBe(404);
    expect(errorBodyOf(byId)).toEqual(errorBodyOf(absentById));
    expect(errorBodyOf(byId)).toEqual(await absentBody(c1, 'en-US'));
  });

  it('H1: a language-less redirect resolves in every language, also after its product gains its first L key', async () => {
    const q = await insertProduct(k('s0'));
    // s0 → s1 writes `(NULL, s0)`; only then does Q get its first pl-PL key.
    await putKeys(q, { globalKey: k('s1') });
    await putKeys(q, { channelKeys: inBoth('pl-PL', k('q-pl')) });

    await expectRedirect(k('s0'), c1, 'en-US', k('s1'));
    await expectRedirect(k('s0'), c1, 'pl-PL', k('q-pl'));
    await expectRedirect(k('s0'), c2, 'pl-PL', k('q-pl'));
  });

  it('the JSON lookup answers an id, a current key at (C, L) and the global key — never a redirect (R28)', async () => {
    const p = await insertProduct(k('block'));
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('blok-1')) });
    await putKeys(p, { channelKeys: inBoth('pl-PL', k('blok-2')) });

    const lookup = (idOrSlug: string, language: string) =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${encodeURIComponent(idOrSlug)}`,
        headers: { 'x-sales-channel': c1.code, 'accept-language': language },
      });

    for (const [handle, language] of [
      [p, 'pl-PL'],
      [k('blok-2'), 'pl-PL'],
      // The global key is a stable handle (CMS product blocks), in every language.
      [k('block'), 'pl-PL'],
      [k('block'), 'en-US'],
    ] as const) {
      const res = await lookup(handle, language);
      expect(res.statusCode, `${handle} ${language}: ${res.body}`).toBe(200);
      expect((res.json() as { data: { id: string } }).data.id).toBe(p);
    }
    // An old key is a redirect, which this lookup never answers.
    const old = await lookup(k('blok-1'), 'pl-PL');
    expect(old.statusCode).toBe(404);
  });

  it('carries the effective key per (C, L) on the PDP and listing summaries, and ready paths on the PDP (R28, FR-074)', async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const p = await insertProduct(k('wrench'));
    await putKeys(p, {
      channelKeys: [
        { channelId: c1.id, languageCode: 'pl-PL', key: k('klucz') },
        { channelId: c2.id, languageCode: 'pl-PL', key: k('klucz-c2') },
      ],
    });

    const pdp = async (channel: { code: string }, language: string) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${p}`,
        headers: { 'x-sales-channel': channel.code, 'accept-language': language },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as {
        data: { slug: string; paths: { canonical: string; alternates: Array<{ languageCode: string; path: string }>; xDefault: string } };
      }).data;
    };

    const atC1pl = await pdp(c1, 'pl-PL');
    expect(atC1pl.slug).toBe(k('klucz'));
    expect(atC1pl.paths.canonical).toBe(`/pl/p/${k('klucz')}`);
    expect([...atC1pl.paths.alternates].sort((a, b) => a.languageCode.localeCompare(b.languageCode))).toEqual([
      { languageCode: 'en-US', path: `/en/p/${k('wrench')}` },
      { languageCode: 'pl-PL', path: `/pl/p/${k('klucz')}` },
    ]);
    expect((await pdp(c2, 'pl-PL')).paths.canonical).toBe(`/pl/p/${k('klucz-c2')}`);
    // Feature 167 (url-shape §8) — x-default is the unprefixed URL of the default
    // language's key, in both setting states.
    expect(atC1pl.paths.xDefault).toBe(`/p/${k('wrench')}`);
    await sql(`update sales_channels set prefix_default_language = false where id = ?`, [c1.id]);
    await h.salesChannels.cache.invalidateAll();
    try {
      const off = await pdp(c1, 'en-US');
      expect(off.paths.canonical).toBe(`/p/${k('wrench')}`);
      expect([...off.paths.alternates].sort((a, b) => a.languageCode.localeCompare(b.languageCode))).toEqual([
        { languageCode: 'en-US', path: `/p/${k('wrench')}` },
        { languageCode: 'pl-PL', path: `/pl/p/${k('klucz')}` },
      ]);
      expect(off.paths.xDefault).toBe(`/p/${k('wrench')}`);
    } finally {
      await sql(`update sales_channels set prefix_default_language = true where id = ?`, [c1.id]);
      await h.salesChannels.cache.invalidateAll();
    }
    expect((await pdp(c1, 'en-US')).slug).toBe(k('wrench'));

    // An alternate is listed only where the product is available to the anonymous audience.
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'pl-PL', 'inactive', now(), now())`,
      [p, c1.id],
    );
    try {
      const atC1en = await pdp(c1, 'en-US');
      expect(atC1en.paths.alternates).toEqual([{ languageCode: 'en-US', path: `/en/p/${k('wrench')}` }]);
    } finally {
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [p]);
    }

    // `changedSince` keeps the listing on the Postgres path (a text query may go to the index).
    const listing = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?changedSince=${encodeURIComponent(before)}&limit=200`,
      headers: { 'x-sales-channel': c2.code, 'accept-language': 'pl-PL' },
    });
    expect(listing.statusCode, listing.body).toBe(200);
    const card = (listing.json() as { data: Array<{ id: string; slug: string }> }).data.find((row) => row.id === p);
    expect(card?.slug).toBe(k('klucz-c2'));
  });
});
