import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, productPath, type CatalogProductScopeWritePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 174, US2 (T030; FR-016, `contracts/url-keys.md` §2–§4, owner round 7) — URL keys at
 * Global, Channel and Channel × language:
 * - a key text is one product's per channel across all the channel's languages (the same product
 *   may repeat it), orphans included; another channel is free;
 * - a Global key collides with any key anywhere;
 * - an orphan keeps reserving its key; re-adding its product collides with nothing;
 * - redirects per (channel, language); a key held by another product's redirect needs a confirmed
 *   takeover, which deletes that redirect; the connector port never takes over;
 * - parallel G and C×L writes of one key from two connections serialise: exactly one wins;
 * - at most 50 redirects per (product, channel);
 * - the grammar refuses `//host`, `/\host`, `..`, `%2f`, `:`, whitespace, upper case, non-ASCII;
 * - a redirect target is `productPath()` of the effective key.
 */
describe('174 US2 — URL keys at G, C and C×L (T030)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let channelCode: string;
  let elsewhere: string;
  const key = (base: string) => `${base}-${fx.run}`;

  const putKeys = (productId: string, body: object) =>
    h.app.inject({ method: 'PUT', url: `/api/v1/admin/catalog/products/${productId}/url-keys`, ...ADMIN, payload: body });
  const ok = async (productId: string, body: object) => {
    const res = await putKeys(productId, body);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { data: { redirects?: Array<{ channelId: string; languageCode: string; key: string }> } };
  };
  const errorOf = (res: Awaited<ReturnType<typeof putKeys>>) => (res.json() as { error: { code: string; details: Record<string, unknown> } }).error;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    elsewhere = await fx.channel(['pl-PL']);
    const [row] = await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [channel]);
    channelCode = row!.code;
    await fx.sql(`update sales_channels set active = true where id = ?`, [channel]);
    await fx.sql(`insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?) on conflict do nothing`, [
      channel,
      TEST_ORGANIZATION_ID,
    ]);
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('one product per key per channel across languages; the same product may repeat it; another channel is free', async () => {
    const p1 = await fx.product({ channels: [channel, elsewhere] });
    const p2 = await fx.product({ channels: [channel, elsewhere] });
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('shared') }] });
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('shared') }] });
    const taken = await putKeys(p2, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('shared') }] });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken), taken.body).toMatchObject({
      code: ERROR_CODES.URL_KEY_TAKEN,
      details: { conflicts: expect.arrayContaining([expect.objectContaining({ channelId: channel, key: key('shared'), heldByProductId: p1 })]) },
    });
    expect((await putKeys(p2, { channelKeys: [{ channelId: channel, languageCode: null, key: key('shared') }] })).statusCode).toBe(409);
    await ok(p2, { channelKeys: [{ channelId: elsewhere, languageCode: 'pl-PL', key: key('shared') }] });
    // A Global key collides with any key anywhere.
    const global = await putKeys(await fx.product(), { globalKey: key('shared') });
    expect(global.statusCode).toBe(409);
    expect(errorOf(global).code).toBe(ERROR_CODES.URL_KEY_TAKEN);
  });

  it('an orphan keeps reserving its key; re-adding its product collides with nothing', async () => {
    const p1 = await fx.product({ channels: [channel] });
    const p2 = await fx.product({ channels: [channel] });
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: null, key: key('orphan') }] });
    await fx.sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [channel, p1]);
    const refused = await putKeys(p2, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('orphan') }] });
    expect(refused.statusCode).toBe(409);
    await fx.sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel, p1]);
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('orphan') }] });
  });

  it('redirects per (channel, language), a confirmed takeover, and the connector never taking over', async () => {
    const p1 = await fx.product({ channels: [channel] });
    const p2 = await fx.product({ channels: [channel] });
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('old') }] });
    const moved = await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('new') }] });
    expect(moved.data.redirects?.map((r) => ({ channelId: r.channelId, languageCode: r.languageCode, key: r.key }))).toEqual([
      { channelId: channel, languageCode: 'pl-PL', key: key('old') },
    ]);

    // The connector port reports the redirect holder and writes nothing (no takeover, ever).
    const port = (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
    const viaPort = await port.applyScopes(
      p2,
      { cells: [{ scope: { level: 'channel_language', channelId: channel, languageCode: 'pl-PL' }, field: 'urlKey', op: { op: 'set', value: key('old') } }] },
      { source: 'pim_connector' },
    );
    expect(JSON.stringify(viaPort)).toContain('redirect');
    expect(await fx.sql(`select 1 from product_url_keys where product_id = ?`, [p2])).toEqual([]);

    const required = await putKeys(p2, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('old') }] });
    expect(required.statusCode).toBe(409);
    expect(errorOf(required)).toMatchObject({
      code: ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
      details: { takeovers: [expect.objectContaining({ key: key('old'), losingProductId: p1, channelId: channel })] },
    });
    await ok(p2, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('old') }], confirmTakeover: [key('old')] });
    expect(await fx.sql(`select 1 from product_url_redirects where product_id = ? and key = ?`, [p1, key('old')])).toEqual([]);
  });

  it('a redirect target is productPath() of the effective key at (C, L)', async () => {
    const p1 = await fx.product({ channels: [channel] });
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('was') }] });
    await ok(p1, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('is') }] });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/resolve/${encodeURIComponent(key('was'))}`,
      headers: { 'x-sales-channel': channelCode, 'accept-language': 'pl-PL' },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { kind: string; key: string; path: string } };
    expect(body.data).toMatchObject({ kind: 'redirect', key: key('is') });
    expect(body.data.path).toBe(
      productPath({ key: key('is'), languageCode: 'pl-PL', channel: { languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: true } }),
    );
  });

  it('the scoped-values save writes the key at its scope, through the same checks, and audits the redirects', async () => {
    const p1 = await fx.product({ channels: [channel] });
    const p2 = await fx.product({ channels: [channel] });
    await fx.save(p1, { channelId: channel, languageCode: 'pl-PL' }, { urlKey: key('save-a') });
    expect((await fx.read(p1, { channelId: channel, languageCode: 'pl-PL' })).fields.urlKey).toMatchObject({ value: key('save-a'), source: 'set' });
    await fx.save(p1, { channelId: channel, languageCode: 'pl-PL' }, { urlKey: key('save-b') });
    const [entry] = await fx.sql<{ state_after: { urlKey?: { redirectsInserted: Array<{ key: string }> } } }>(
      `select state_after from audit_log_entries where action = 'product.scoped_values.save' and object_id = ? order by acted_at desc limit 1`,
      [p1],
    );
    expect(entry!.state_after.urlKey?.redirectsInserted.map((r) => r.key)).toEqual([key('save-a')]);
    const taken = await fx.put(p2, { channelId: channel }, { urlKey: key('save-b') });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken).code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    // `null` is refused: the URL key is required (FR-062).
    const empty = await fx.put(p2, { channelId: channel }, { urlKey: null });
    expect(empty.statusCode).toBe(422);
  });

  it('parallel Global and C×L writes of one key serialise: exactly one wins', async () => {
    const a = await fx.product({ channels: [channel] });
    const b = await fx.product({ channels: [channel] });
    const [ra, rb] = await Promise.all([
      putKeys(a, { globalKey: key('race') }),
      putKeys(b, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('race') }] }),
    ]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
  });

  // Ported from 163's url-key-uniqueness (Q-M6, T105a) on the 174 keys (T047).
  it('a derived global key (create, duplicate) skips every key another product holds, orphans and redirects included', async () => {
    const holder = await fx.product({ channels: [channel] });
    await ok(holder, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key('derived-cl') }] });
    await ok(holder, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('derived-gone') }] });
    await ok(holder, { channelKeys: [{ channelId: channel, languageCode: 'en-US', key: key('derived-gone-2') }] });
    const create = async (name: string) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        ...ADMIN,
        payload: { sku: `UK-${fx.run}-${name.length}-${Math.random().toString(36).slice(2, 8)}`, type: 'simple', name, description: '', categoryIds: [], attributeValues: {}, visibility: 'public' },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string; slug: string } }).data;
    };
    for (const base of ['derived-cl', 'derived-gone']) {
      const created = await create(key(base));
      expect(created.slug, base).toBe(`${key(base)}-2`);
      await fx.sql(`delete from products where id = ?`, [created.id]);
    }
    const source = await fx.product({ channels: [channel] });
    const [sourceRow] = await fx.sql<{ slug: string }>(`select slug from products where id = ?`, [source]);
    await ok(holder, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: `${sourceRow!.slug}-copy` }] });
    const dup = await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${source}/duplicate`, ...ADMIN });
    expect(dup.statusCode, dup.body).toBe(201);
    const copy = (dup.json() as { data: { id: string; slug: string } }).data;
    expect(copy.slug).toBe(`${sourceRow!.slug}-copy-2`);
    await fx.sql(`delete from products where id = ?`, [copy.id]);
  });

  it('an orphaned key is removed by inherit, never written (FR-101, 163 FR-015)', async () => {
    const own = await fx.channel(['pl-PL', 'de-DE']);
    const p = await fx.product({ channels: [own] });
    await ok(p, {
      channelKeys: [
        { channelId: own, languageCode: 'pl-PL', key: key('orphan-pl') },
        { channelId: own, languageCode: 'de-DE', key: key('orphan-de') },
      ],
    });
    await fx.sql(`update sales_channels set languages = '["pl-PL"]'::jsonb where id = ?`, [own]);
    await h.salesChannels.cache.invalidateAll();
    const write = await putKeys(p, { channelKeys: [{ channelId: own, languageCode: 'de-DE', key: key('orphan-de-2') }] });
    expect(write.statusCode).toBe(422);
    expect(errorOf(write)).toMatchObject({ code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'language_not_offered' } });
    await ok(p, { channelKeys: [{ channelId: own, languageCode: 'de-DE', key: { inherit: true } }] });
    await fx.sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [own, p]);
    const write2 = await putKeys(p, { channelKeys: [{ channelId: own, languageCode: 'pl-PL', key: key('orphan-pl-2') }] });
    expect(write2.statusCode).toBe(422);
    expect(errorOf(write2)).toMatchObject({ code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'not_a_member' } });
    await ok(p, { channelKeys: [{ channelId: own, languageCode: 'pl-PL', key: { inherit: true } }] });
    expect(await fx.sql(`select key from product_url_keys where product_id = ?`, [p])).toEqual([]);
  });

  it('keeps at most 50 redirects per (product, channel)', async () => {
    const p = await fx.product({ channels: [channel] });
    for (let i = 0; i <= 51; i += 1) {
      await ok(p, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: key(`cap-${i}`) }] });
    }
    const [row] = await fx.sql<{ n: string }>(
      `select count(*)::text as n from product_url_redirects where product_id = ? and sales_channel_id = ?`,
      [p, channel],
    );
    expect(Number(row!.n)).toBe(50);
  });

  it.each(['//host', '/\\host', '..', '%2f', 'a:b', 'two words', ' lead', 'UPPER', '\u017c\u00f3\u0142w'])('refuses the key %j', async (bad) => {
    const p = await fx.product({ channels: [channel] });
    const res = await putKeys(p, { channelKeys: [{ channelId: channel, languageCode: 'pl-PL', key: bad }] });
    expect(res.statusCode).toBe(400);
    const save = await fx.put(p, { channelId: channel, languageCode: 'pl-PL' }, { urlKey: bad });
    expect(bad === 'UPPER' ? [200] : [400]).toContain(save.statusCode); // the save lower-cases (NFC + lower-case)
  });
});
