import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  productKeyResolutionSchema,
  productUrlKeysResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { errorBodyOf } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 17 (T108) — redirects while `seo` is off
 * (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md` §1, §4;
 * research R12, owner decision Q-C; FR-111, US7 #10; Constitution XVII).
 *
 * `catalog` owns the redirect rows and `seo` owns whether they are **served**:
 *
 * - with `seo` off a redirect key answers what a key of no product answers, while
 *   the product's current keys keep serving;
 * - the rows persist, and keep reserving their keys: a write meeting another
 *   product's redirect still requires a takeover confirmation naming the loser;
 * - `GET …/url-keys` omits `redirects` (the admin then shows no redirect list);
 * - with `seo` on again the same rows are served and listed — off is
 *   non-destructive.
 *
 * Driven on the operator axis (`deactivated` while platform-available), which is
 * the case an operator creates from `/platform/modules`.
 */
describe('URL redirects with seo off (spec 163, T108)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const products: string[] = [];
  let channel: { id: string; code: string };

  const k = (base: string): string => `${base}-${run}`;

  async function sql(query: string, params: unknown[] = []): Promise<void> {
    await h.em().getConnection().execute(query, params);
  }

  async function insertProduct(slug: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, visibility, allowed_organization_ids,
                             created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?, null, 'public', '[]'::jsonb, now(), now())`,
      [id, `O163-${run}-${products.length}`, slug, `Seo off ${slug}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel.id, id]);
    products.push(id);
    return id;
  }

  const keysUrl = (productId: string): string => `/api/v1/admin/catalog/products/${productId}/url-keys`;

  async function putKeys(productId: string, payload: unknown) {
    return h.app.inject({ method: 'PUT', url: keysUrl(productId), ...admin, payload: payload as object });
  }

  function resolveRaw(key: string, language: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/resolve/${encodeURIComponent(key)}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': language },
    });
  }

  async function redirectRows(productId: string): Promise<Array<{ language_code: string | null; key: string }>> {
    return h
      .em()
      .getConnection()
      .execute(`select language_code, key from product_url_redirects where product_id = ? order by key`, [productId]);
  }

  let p: string;
  let q: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    channel = { id: randomUUID(), code: `o163-${run}` };
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channel.id, channel.code, JSON.stringify({ 'en-US': '163 seo off' })],
    );
    // P: `old` → `new` leaves `(NULL, old)`; its pl-PL key leaves `(pl-PL, new)`.
    p = await insertProduct(k('old'));
    expect((await putKeys(p, { globalKey: k('new') })).statusCode).toBe(200);
    // Feature 174 — 163's pl-PL language key is the channel's (C, pl-PL) key.
    expect((await putKeys(p, { channelKeys: [{ channelId: channel.id, languageCode: 'pl-PL', key: k('nowy') }] })).statusCode).toBe(200);
    q = await insertProduct(k('other'));
  });

  afterAll(async () => {
    if (h) {
      if (products.length > 0) {
        const list = products.map(() => '?').join(',');
        await sql(`delete from sales_channel_products where product_id in (${list})`, products);
        await sql(`delete from products where id in (${list})`, products);
      }
      await sql(`delete from sales_channels where id = ?`, [channel.id]);
      await teardownBackendServer(h);
    }
  });

  it('serves redirects while seo is on (positive control)', async () => {
    const res = await resolveRaw(k('old'), 'en-US');
    expect(res.statusCode, res.body).toBe(200);
    expect(productKeyResolutionSchema.parse((res.json() as { data: unknown }).data)).toMatchObject({
      kind: 'redirect',
      key: k('new'),
    });
    const keys = await h.app.inject({ method: 'GET', url: keysUrl(p), ...admin });
    expect(productUrlKeysResponseSchema.parse(keys.json()).data.redirects?.length).toBe(2);
  });

  it('answers not-found for a redirect key, omits the list, keeps the rows and the takeover rule while off', async () => {
    const rowsBefore = await redirectRows(p);
    // The localised message follows the request language: one reference per language.
    const absent: Record<string, unknown> = {};
    for (const language of ['en-US', 'pl-PL']) {
      const res = await resolveRaw(k('nobody-holds-this'), language);
      expect(res.statusCode).toBe(404);
      absent[language] = errorBodyOf(res);
    }

    await withModuleOff('seo', 'deactivated', async () => {
      for (const [key, language] of [
        [k('old'), 'en-US'],
        [k('old'), 'pl-PL'],
      ] as const) {
        const res = await resolveRaw(key, language);
        expect(res.statusCode, `${key} ${language}: ${res.body}`).toBe(404);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
        expect(errorBodyOf(res)).toEqual(absent[language]);
      }
      // Feature 167 (FR-024) — `new` is a former pl-PL key, whose redirect row is seo's
      // and hidden while off, but it is also the product's **current** en-US key, and a
      // current key of another channel language answers a temporary redirect to the
      // product's key in the path language whatever seo's state: no redirect row is read.
      const crossLanguage = await resolveRaw(k('new'), 'pl-PL');
      expect(crossLanguage.statusCode, crossLanguage.body).toBe(200);
      expect(productKeyResolutionSchema.parse((crossLanguage.json() as { data: unknown }).data)).toMatchObject({
        kind: 'redirect',
        key: k('nowy'),
        permanent: false,
      });
      // Current keys are catalog's and keep serving.
      const current = await resolveRaw(k('nowy'), 'pl-PL');
      expect(current.statusCode, current.body).toBe(200);
      expect(productKeyResolutionSchema.parse((current.json() as { data: unknown }).data)).toEqual({
        kind: 'product',
        productId: p,
        key: k('nowy'),
      });

      // Q-C: the admin answer carries no redirect list.
      const keys = await h.app.inject({ method: 'GET', url: keysUrl(p), ...admin });
      expect(keys.statusCode, keys.body).toBe(200);
      const data = productUrlKeysResponseSchema.parse(keys.json()).data;
      expect('redirects' in data).toBe(false);

      // Writes are never gated, and the rows keep reserving their keys (FR-111).
      const takeover = await putKeys(q, { globalKey: k('old') });
      expect(takeover.statusCode, takeover.body).toBe(409);
      const body = takeover.json() as {
        error: { code: string; details: { takeovers: Array<{ losingProductId: string; key: string }> } };
      };
      expect(body.error.code).toBe(ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED);
      // Feature 174 (`url-keys.md` §3): the old Global key left a redirect at each (C, L) pair.
      const takeovers = body.error.details.takeovers as Array<{ key: string; losingProductId: string; languageCode: string }>;
      expect(takeovers.length).toBeGreaterThan(0);
      expect(takeovers.every((t) => t.key === k('old') && t.losingProductId === p)).toBe(true);
      expect(new Set(takeovers.map((t) => t.languageCode))).toEqual(new Set(['en-US', 'pl-PL']));
      expect(await redirectRows(p)).toEqual(rowsBefore);
    });

    // On again: the same rows are served and listed.
    expect(await redirectRows(p)).toEqual(rowsBefore);
    const back = await resolveRaw(k('old'), 'pl-PL');
    expect(back.statusCode, back.body).toBe(200);
    expect(productKeyResolutionSchema.parse((back.json() as { data: unknown }).data)).toMatchObject({
      kind: 'redirect',
      key: k('nowy'),
    });
    const keys = await h.app.inject({ method: 'GET', url: keysUrl(p), ...admin });
    expect(productUrlKeysResponseSchema.parse(keys.json()).data.redirects?.length).toBe(rowsBefore.length);
  });
});
