import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 16 (T100) — URL keys are unique per language across every
 * channel, and the redirects they leave behind keep that invariant
 * (`specs/163-product-data-scopes/data-model.md` §5, research R11; FR-014, FR-015,
 * FR-070, FR-072, SC-008, US7 #2, #4, #5, #7, #8; re-analyze H1 and HIGH-2).
 *
 * Every write goes through `PUT /api/v1/admin/catalog/products/:id/url-keys`, the
 * Command that takes one advisory lock per touched key. State is asserted on the
 * rows (`product_url_keys`, `product_url_redirects`); serving a key at (C, L) is
 * Phase 17's resolution test (T107), so where this file says "still resolves" it
 * asserts the rows the resolution order reads.
 *
 * Products are inserted with per-run slugs and their own channels (deleted in
 * `afterAll`, their key rows go with them by cascade). Every key carries the run
 * suffix, so two runs against one database never meet.
 */
describe('URL-key uniqueness and redirects (spec 163, T100)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const channels: string[] = [];
  const products: string[] = [];

  /** Channel A offers pl + de; B offers pl + en; C offers fr only (used for orphaning). */
  let chA: string;
  let chB: string;
  let chC: string;

  const k = (base: string): string => `${base}-${run}`;

  interface KeyRow {
    language_code: string;
    sales_channel_id: string | null;
    key: string;
  }
  interface RedirectRow {
    id: string;
    product_id: string;
    language_code: string | null;
    key: string;
  }
  interface ErrorBody {
    error: { code: string; details?: Record<string, unknown> };
  }

  async function insertChannel(languages: string[]): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
         values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', now(), now())`,
        [id, `u162-${run}-${channels.length}`, JSON.stringify({ 'en-US': `162 keys ${run}` }), languages[0], JSON.stringify(languages)],
      );
    channels.push(id);
    return id;
  }

  async function insertProduct(name: string, slug: string, memberOf: string[]): Promise<string> {
    const id = randomUUID();
    const conn = h.em().getConnection();
    await conn.execute(
      `insert into products (id, sku, slug, type, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', ?::jsonb, '{}', now(), now())`,
      [id, `U162-${run}-${products.length}`, slug, JSON.stringify({ 'en-US': name })],
    );
    for (const channelId of memberOf) {
      await conn.execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, id]);
    }
    products.push(id);
    return id;
  }

  async function put(productId: string, payload: unknown) {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/url-keys`,
      ...admin,
      payload: payload as object,
    });
  }

  async function putOk(productId: string, payload: unknown): Promise<void> {
    const res = await put(productId, payload);
    expect(res.statusCode, res.body).toBe(200);
  }

  async function keysOf(productId: string): Promise<KeyRow[]> {
    return h
      .em()
      .getConnection()
      .execute<KeyRow[]>(
        `select language_code, sales_channel_id, key from product_url_keys where product_id = ? order by language_code, sales_channel_id nulls first`,
        [productId],
      );
  }

  async function redirectsOf(productId: string): Promise<RedirectRow[]> {
    return h
      .em()
      .getConnection()
      .execute<RedirectRow[]>(
        `select id, product_id, language_code, key from product_url_redirects where product_id = ? order by language_code nulls first, key`,
        [productId],
      );
  }

  const tag = (rows: Array<{ language_code: string | null; key: string }>): string[] =>
    rows.map((r) => `${r.language_code ?? '*'}:${r.key}`).sort();

  async function slugOf(productId: string): Promise<string> {
    const [row] = await h.em().getConnection().execute<Array<{ slug: string }>>(`select slug from products where id = ?`, [productId]);
    if (!row) throw new Error(`no product ${productId}`);
    return row.slug;
  }

  async function snapshot(productIds: string[]): Promise<string> {
    const parts: unknown[] = [];
    for (const id of productIds) parts.push([await slugOf(id), await keysOf(id), await redirectsOf(id)]);
    return JSON.stringify(parts);
  }

  /**
   * SC-008 over the given products: in no language does one key belong to two of
   * them, current or redirecting — a product's keys in L being its rows of L plus
   * its global key where it has no language key of L, and a language-less redirect
   * counting in every language.
   */
  async function assertNoSharedKey(productIds: string[]): Promise<void> {
    const conn = h.em().getConnection();
    const languages = (
      await conn.execute<Array<{ code: string }>>(
        `select distinct jsonb_array_elements_text(languages) as code from sales_channels where id = any(?::uuid[])`,
        [`{${channels.join(',')}}`],
      )
    ).map((r) => r.code);
    for (const language of languages) {
      const owners = new Map<string, string>();
      for (const productId of productIds) {
        const keys = await keysOf(productId);
        const mine = new Set(keys.filter((r) => r.language_code === language).map((r) => r.key));
        if (!keys.some((r) => r.language_code === language && r.sales_channel_id === null)) mine.add(await slugOf(productId));
        for (const r of await redirectsOf(productId)) {
          if (r.language_code === null || r.language_code === language) mine.add(r.key);
        }
        for (const key of mine) {
          const other = owners.get(key);
          expect(other === undefined || other === productId, `${language}:${key} held by two products`).toBe(true);
          owners.set(key, productId);
        }
      }
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    chA = await insertChannel(['pl-PL', 'de-DE']);
    chB = await insertChannel(['pl-PL', 'en-GB']);
    chC = await insertChannel(['fr-FR']);
  }, 60_000);

  afterAll(async () => {
    const conn = h.em().getConnection();
    for (const id of products) await conn.execute(`delete from products where id = ?`, [id]);
    for (const id of channels) await conn.execute(`delete from sales_channels where id = ?`, [id]);
    await teardownBackendServer(h);
  });

  describe('a key of another product in the language is refused, naming it (US7 #2)', () => {
    it("another product's language key", async () => {
      const p = await insertProduct('Holder', k('holder-a'), [chA]);
      const q = await insertProduct('Writer', k('writer-a'), [chB]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('wiertarka') }] });
      const before = await snapshot([p, q]);
      const res = await put(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('wiertarka') }] });
      expect(res.statusCode).toBe(409);
      expect(res.json() as ErrorBody).toMatchObject({
        error: {
          code: ERROR_CODES.URL_KEY_TAKEN,
          details: { conflicts: [{ languageCode: 'pl-PL', key: k('wiertarka'), heldByProductId: p, heldByProductName: 'Holder' }] },
        },
      });
      expect(await snapshot([p, q])).toBe(before);
    });

    it("another product's global key where it has no key of the language; free where it has one", async () => {
      const p = await insertProduct('Global holder', k('mlot'), [chA]);
      const q = await insertProduct('Writer', k('writer-b'), [chB]);
      const res = await put(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('mlot') }] });
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.URL_KEY_TAKEN,
        details: { conflicts: [{ languageCode: 'pl-PL', key: k('mlot'), heldByProductId: p }] },
      });
      // In German P's slug is its key too — and also in English, which no channel of P offers.
      expect((await put(q, { languageKeys: [{ languageCode: 'en-GB', key: k('mlot') }] })).statusCode).toBe(409);
    });

    it("US7 #7: another product's channel × language key in a channel the writer is not in; adding it there later never clashes (SC-008)", async () => {
      const p = await insertProduct('Channel A product', k('drill-a'), [chA]);
      const q = await insertProduct('Channel B product', k('drill-b'), [chB]);
      await putOk(p, { channelKeys: [{ channelId: chA, languageCode: 'pl-PL', key: k('drill') }] });
      const asLanguageKey = await put(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('drill') }] });
      expect(asLanguageKey.statusCode).toBe(409);
      expect((asLanguageKey.json() as ErrorBody).error.details).toMatchObject({ conflicts: [{ heldByProductId: p }] });
      const asChannelKey = await put(q, { channelKeys: [{ channelId: chB, languageCode: 'pl-PL', key: k('drill') }] });
      expect(asChannelKey.statusCode).toBe(409);

      // Membership and channel-language changes are never checked and never refused.
      const conn = h.em().getConnection();
      await conn.execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [chA, q]);
      await conn.execute(`update sales_channels set languages = '["pl-PL","en-GB","de-DE"]'::jsonb where id = ?`, [chB]);
      await assertNoSharedKey([p, q]);
      await conn.execute(`update sales_channels set languages = '["pl-PL","en-GB"]'::jsonb where id = ?`, [chB]);
    });

    it('an orphaned channel × language key keeps reserving its key (FR-015, FR-070)', async () => {
      const p = await insertProduct('Orphan holder', k('orphan-holder'), [chA]);
      const q = await insertProduct('Writer', k('writer-c'), [chB]);
      await putOk(p, { channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: k('bohrer') }] });
      // P leaves channel A: its (A, de) key is orphaned and still holds "bohrer" in German.
      await h.em().getConnection().execute(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [chA, p]);
      await h.em().getConnection().execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [chA, q]);
      const res = await put(q, { languageKeys: [{ languageCode: 'de-DE', key: k('bohrer') }] });
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error.details).toMatchObject({ conflicts: [{ heldByProductId: p }] });
      // The orphan is removable whatever the membership says.
      await putOk(p, { channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: null }] });
      expect(await keysOf(p)).toEqual([]);
    });

    it('a global key is checked in every language', async () => {
      const p = await insertProduct('Holder', k('global-holder'), [chB]);
      const q = await insertProduct('Writer', k('global-writer'), [chA]);
      await putOk(p, { languageKeys: [{ languageCode: 'en-GB', key: k('tool') }] });
      const res = await put(q, { globalKey: k('tool') });
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error.details).toMatchObject({
        conflicts: [{ languageCode: 'en-GB', key: k('tool'), heldByProductId: p }],
      });
      expect(await slugOf(q)).toBe(k('global-writer'));
    });

    // Phase 16 review — `products.slug` is unique across soft-deleted rows, so a deleted
    // product's global key is refused (409), never reaching the index as a 500.
    it("a soft-deleted product's global key is refused as a global and as a language key", async () => {
      const p = await insertProduct('Deleted holder', k('deleted-holder'), [chA]);
      const q = await insertProduct('Writer', k('deleted-writer'), [chA]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('deleted-pl') }] });
      await h.em().getConnection().execute(`update products set deleted_at = now() where id = ?`, [p]);

      const asGlobal = await put(q, { globalKey: k('deleted-holder') });
      expect(asGlobal.statusCode, asGlobal.body).toBe(409);
      expect((asGlobal.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.URL_KEY_TAKEN,
        details: { conflicts: [{ key: k('deleted-holder'), heldByProductId: p }] },
      });
      expect(await slugOf(q)).toBe(k('deleted-writer'));
      // Its language keys no longer count, so the slug is taken in Polish too.
      const asLanguageKey = await put(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('deleted-holder') }] });
      expect(asLanguageKey.statusCode, asLanguageKey.body).toBe(409);
      // …while its former Polish key is free.
      await putOk(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('deleted-pl') }] });
    });

    it('the same key in another language, and in several channels of one language for one product, is accepted', async () => {
      const p = await insertProduct('Polish', k('lang-p'), [chA, chB]);
      const q = await insertProduct('German', k('lang-q'), [chA]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('same') }] });
      await putOk(q, { languageKeys: [{ languageCode: 'de-DE', key: k('same') }] });
      await putOk(p, {
        channelKeys: [
          { channelId: chA, languageCode: 'pl-PL', key: k('pro') },
          { channelId: chB, languageCode: 'pl-PL', key: k('pro') },
        ],
      });
      await assertNoSharedKey([p, q]);
    });
  });

  describe('redirects (FR-072)', () => {
    it('a change keeps the old key as a redirect in its language; a second change never chains (US7 #4)', async () => {
      const p = await insertProduct('Changer', k('changer'), [chA]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('v1') }] });
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('v2') }] });
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('v3') }] });
      // Every row names the product, never a key: both old keys point at the current one.
      expect(tag(await redirectsOf(p))).toEqual([`pl-PL:${k('changer')}`, `pl-PL:${k('v1')}`, `pl-PL:${k('v2')}`].sort());
      expect((await redirectsOf(p)).every((r) => r.product_id === p)).toBe(true);
    });

    it('US7 #8: the first language key turns the global key into a redirect of that language only', async () => {
      const p = await insertProduct('First key', k('first'), [chA, chB]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('pierwszy') }] });
      expect(tag(await redirectsOf(p))).toEqual([`pl-PL:${k('first')}`]);
      expect(await slugOf(p)).toBe(k('first'));
    });

    it('writing its own redirect back removes it (no self-redirect)', async () => {
      const p = await insertProduct('Back', k('back'), [chA]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('b1') }] });
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('b2') }] });
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('b1') }] });
      const redirects = tag(await redirectsOf(p));
      expect(redirects).not.toContain(`pl-PL:${k('b1')}`);
      expect(redirects).toContain(`pl-PL:${k('b2')}`);
    });

    it("US7 #5: another product's redirect in the language needs a confirmation naming it; on confirmation it is removed", async () => {
      const p = await insertProduct('Loser', k('loser'), [chA]);
      const q = await insertProduct('Taker', k('taker'), [chB]);
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('old') }] });
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('new') }] });
      const before = await snapshot([p, q]);
      const asked = await put(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('old') }] });
      expect(asked.statusCode).toBe(409);
      expect(asked.json() as ErrorBody).toMatchObject({
        error: {
          code: ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
          details: { takeovers: [{ languageCode: 'pl-PL', key: k('old'), losingProductId: p, losingProductName: 'Loser' }] },
        },
      });
      expect(await snapshot([p, q])).toBe(before);
      await putOk(q, {
        languageKeys: [{ languageCode: 'pl-PL', key: k('old') }],
        confirmTakeover: [{ languageCode: 'pl-PL', key: k('old') }],
      });
      expect(tag(await redirectsOf(p))).not.toContain(`pl-PL:${k('old')}`);
      await assertNoSharedKey([p, q]);
    });

    it("H1: a language-less redirect of Q needs a takeover for an L key in every L — even where Q holds an L key — and goes in every language", async () => {
      const q = await insertProduct('Old global', k('q-old'), [chA, chB]);
      const p = await insertProduct('Taker', k('p-taker'), [chA, chB]);
      await putOk(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('q-pl') }] });
      await putOk(q, { globalKey: k('q-new') });
      expect(tag(await redirectsOf(q))).toContain(`*:${k('q-old')}`);
      for (const languageCode of ['pl-PL', 'de-DE', 'en-GB']) {
        const res = await put(p, { languageKeys: [{ languageCode, key: k('q-old') }] });
        expect(res.statusCode, languageCode).toBe(409);
        const error = (res.json() as ErrorBody).error;
        expect(error.code).toBe(ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED);
        expect((error.details as { takeovers: unknown[] }).takeovers).toEqual(
          expect.arrayContaining([
            { languageCode: null, key: k('q-old'), losingProductId: q, losingProductName: 'Old global' },
          ]),
        );
      }
      await putOk(p, {
        languageKeys: [{ languageCode: 'de-DE', key: k('q-old') }],
        confirmTakeover: [{ languageCode: null, key: k('q-old') }],
      });
      // The language-less row is gone in every language; Q's own Polish row (left by its
      // first Polish key) is a different row and stays.
      expect(tag(await redirectsOf(q)).filter((t) => t.endsWith(k('q-old')))).toEqual([`pl-PL:${k('q-old')}`]);
      await assertNoSharedKey([p, q]);
    });

    it('H1: P writing its own language-less redirect as an L key keeps the row; writing it back as the global key replaces it per held language', async () => {
      const p = await insertProduct('Own redirect', k('own-old'), [chA, chB]);
      await putOk(p, { globalKey: k('own-new') });
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('own-old') }] });
      expect(tag(await redirectsOf(p))).toContain(`*:${k('own-old')}`);
      await putOk(p, { channelKeys: [{ channelId: chB, languageCode: 'en-GB', key: k('own-en') }] });
      // P's Polish key moves on, so "own-old" is no longer one of its keys in Polish.
      await putOk(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('own-pl') }] });

      await putOk(p, { globalKey: k('own-old') });
      const redirects = tag(await redirectsOf(p));
      expect(redirects).not.toContain(`*:${k('own-old')}`);
      expect(redirects).toEqual(expect.arrayContaining([`pl-PL:${k('own-old')}`, `en-GB:${k('own-old')}`, `*:${k('own-new')}`]));
      expect(redirects).not.toContain(`de-DE:${k('own-old')}`);
    });

    it('with no collision a global-key change writes exactly one language-less redirect', async () => {
      const p = await insertProduct('Plain', k('plain-old'), [chA]);
      await putOk(p, { globalKey: k('plain-new') });
      expect(await slugOf(p)).toBe(k('plain-new'));
      expect(tag(await redirectsOf(p))).toEqual([`*:${k('plain-old')}`]);
    });
  });

  describe('HIGH-2 — a global key another product took in one language', () => {
    it('the old slug redirects per free language only; writing it back is refused naming the holder', async () => {
      const p = await insertProduct('P', k('shared'), [chA, chB]);
      const q = await insertProduct('Q', k('q-shared'), [chA]);
      // P holds a German key, so its slug is not its key in German; P's first key left
      // a German redirect of the slug, which Q takes over by confirmation.
      await putOk(p, { languageKeys: [{ languageCode: 'de-DE', key: k('p-de') }] });
      await putOk(q, {
        languageKeys: [{ languageCode: 'de-DE', key: k('shared') }],
        confirmTakeover: [{ languageCode: 'de-DE', key: k('shared') }],
      });

      await putOk(p, { globalKey: k('shared-2') });
      const redirects = await redirectsOf(p);
      expect(redirects.some((r) => r.language_code === null && r.key === k('shared'))).toBe(false);
      const languages = redirects.filter((r) => r.key === k('shared')).map((r) => r.language_code);
      expect(languages).not.toContain('de-DE');
      expect(languages).toEqual(expect.arrayContaining(['pl-PL', 'en-GB']));
      // In German the key is Q's current key (served for Q); elsewhere it redirects to P.
      expect(await keysOf(q)).toEqual([{ language_code: 'de-DE', sales_channel_id: null, key: k('shared') }]);
      await assertNoSharedKey([p, q]);

      const before = await snapshot([p, q]);
      const back = await put(p, { globalKey: k('shared') });
      expect(back.statusCode).toBe(409);
      expect((back.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.URL_KEY_TAKEN,
        details: { conflicts: [{ languageCode: 'de-DE', key: k('shared'), heldByProductId: q }] },
      });
      expect(await snapshot([p, q])).toBe(before);
    });

    it("sibling: removing P's L key while Q holds P's slug in L is refused while a channel offers L, allowed once orphaned", async () => {
      const p = await insertProduct('P', k('sib'), [chC]);
      const q = await insertProduct('Q', k('q-sib'), [chC]);
      await putOk(p, { languageKeys: [{ languageCode: 'fr-FR', key: k('p-fr') }] });
      await putOk(q, {
        languageKeys: [{ languageCode: 'fr-FR', key: k('sib') }],
        confirmTakeover: [{ languageCode: 'fr-FR', key: k('sib') }],
      });
      const before = await snapshot([p, q]);
      const refused = await put(p, { languageKeys: [{ languageCode: 'fr-FR', key: null }] });
      expect(refused.statusCode).toBe(409);
      expect((refused.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.URL_KEY_TAKEN,
        details: { conflicts: [{ languageCode: 'fr-FR', key: k('sib'), heldByProductId: q }] },
      });
      expect(await snapshot([p, q])).toBe(before);

      // No channel offers French any more: the key is orphaned and its removal allowed (FR-015).
      await h.em().getConnection().execute(`update sales_channels set languages = '["it-IT"]'::jsonb, default_language = 'it-IT' where id = ?`, [chC]);
      try {
        const offered = await h
          .em()
          .getConnection()
          .execute<Array<{ n: string }>>(`select count(*)::text as n from sales_channels where languages @> '["fr-FR"]'::jsonb`);
        if (Number(offered[0]!.n) === 0) {
          await putOk(p, { languageKeys: [{ languageCode: 'fr-FR', key: null }] });
          expect((await keysOf(p)).filter((r) => r.language_code === 'fr-FR')).toEqual([]);
        }
      } finally {
        await h.em().getConnection().execute(`update sales_channels set languages = '["fr-FR"]'::jsonb, default_language = 'fr-FR' where id = ?`, [chC]);
      }
    });
  });

  describe('FR-014 on channel × language keys', () => {
    it('refuses a channel the product is not in, and a language the channel does not offer; nothing is written', async () => {
      const p = await insertProduct('Scoped', k('scoped'), [chA]);
      const notMember = await put(p, { channelKeys: [{ channelId: chB, languageCode: 'pl-PL', key: k('x') }] });
      expect(notMember.statusCode).toBe(422);
      expect((notMember.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.SCOPE_INVALID,
        details: { channelId: chB, reason: 'not_a_member' },
      });
      const notOffered = await put(p, { channelKeys: [{ channelId: chA, languageCode: 'en-GB', key: k('x') }] });
      expect(notOffered.statusCode).toBe(422);
      expect((notOffered.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.SCOPE_INVALID,
        details: { channelId: chA, languageCode: 'en-GB', reason: 'language_not_offered' },
      });
      expect(await keysOf(p)).toEqual([]);
      expect(await redirectsOf(p)).toEqual([]);
    });
  });

  describe('concurrency — two connections, one key (SC-008)', () => {
    it('two products writing one key in one language at once: exactly one wins', async () => {
      for (let round = 0; round < 5; round += 1) {
        const a = await insertProduct('Racer A', k(`race-a-${round}`), [chA]);
        const b = await insertProduct('Racer B', k(`race-b-${round}`), [chB]);
        const contested = k(`contested-${round}`);
        const responses = await Promise.all([
          put(a, { languageKeys: [{ languageCode: 'pl-PL', key: contested }] }),
          put(b, { channelKeys: [{ channelId: chB, languageCode: 'pl-PL', key: contested }] }),
        ]);
        expect(responses.map((r) => r.statusCode).sort(), `round ${round}`).toEqual([200, 409]);
        const loser = responses.find((r) => r.statusCode === 409)!;
        expect((loser.json() as ErrorBody).error.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
        const [count] = await h
          .em()
          .getConnection()
          .execute<Array<{ n: string }>>(`select count(*)::text as n from product_url_keys where key = ?`, [contested]);
        expect(Number(count?.n), `round ${round}`).toBe(1);
      }
    });

    it('a write waits on the key lock and re-reads after it: a holder committed meanwhile refuses it', async () => {
      const p = await insertProduct('Waiter', k('waiter'), [chA]);
      const q = await insertProduct('Holder', k('lock-holder'), [chA]);
      const contested = k('locked');
      const knex = h.em().getConnection().getKnex();
      const trx = await knex.transaction();
      let pending: ReturnType<typeof put> | undefined;
      try {
        await trx.raw('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`catalog.url-key:${contested}`]);
        pending = put(p, { languageKeys: [{ languageCode: 'pl-PL', key: contested }] });
        // Wait until the write is blocked on the advisory lock — the second connection.
        // The poll must see the waiter: timing out silently would let the write run
        // after the holder commits, and the test would pass without exercising the lock.
        let waiters = 0;
        for (let i = 0; i < 100 && waiters === 0; i += 1) {
          const waiting = await knex.raw(
            `select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
          );
          waiters = Number((waiting.rows as Array<{ n: number }>)[0]!.n);
          if (waiters === 0) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiters, 'the write never queued on the key lock').toBeGreaterThan(0);
        await trx.raw(
          `insert into product_url_keys (id, product_id, language_code, sales_channel_id, key) values (?, ?, 'pl-PL', null, ?)`,
          [randomUUID(), q, contested],
        );
        await trx.commit();
      } catch (err) {
        await trx.rollback();
        throw err;
      }
      const res = await pending!;
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.URL_KEY_TAKEN,
        details: { conflicts: [{ heldByProductId: q }] },
      });
      expect(await keysOf(p)).toEqual([]);
    });
  });
  // Final QA Q-M6 (FR-070, SC-008) — the global key a create or a duplicate derives
  // (`CatalogAdminService.allocateUniqueSlug`) skips every key another product holds:
  // a language key, a channel × language key and a redirecting key.
  describe('a derived global key skips keys other products hold (FR-070, SC-008)', () => {
    async function create(name: string): Promise<{ id: string; slug: string }> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        ...admin,
        payload: {
          sku: `U162-${run}-${products.length}`,
          type: 'simple',
          name: name,
          description: '',
          categoryIds: [],
          attributeValues: {},
          visibility: 'public',
          status: 'active',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { id: string; slug: string } }).data;
      products.push(data.id);
      return data;
    }

    it('a created product derives past a language key, a channel × language key and a redirect', async () => {
      const holder = await insertProduct('Derived holder', k('derived-holder'), [chA]);
      await putOk(holder, {
        languageKeys: [{ languageCode: 'pl-PL', key: k('derived-lang') }],
        channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: k('derived-channel') }],
      });
      // The first language key changes: the old one stays as the holder's redirect.
      await putOk(holder, { languageKeys: [{ languageCode: 'de-DE', key: k('derived-gone') }] });
      await putOk(holder, { languageKeys: [{ languageCode: 'de-DE', key: k('derived-gone-2') }] });
      expect(tag(await redirectsOf(holder))).toContain(`de-DE:${k('derived-gone')}`);

      for (const base of ['derived-lang', 'derived-channel', 'derived-gone']) {
        const created = await create(`${base} ${run}`);
        expect(created.slug, base).not.toBe(k(base));
        expect(created.slug, base).toBe(`${k(base)}-2`);
      }
      await assertNoSharedKey([holder, ...products.slice(-3)]);
    });

    it('a duplicate derives its "-copy" key past a key another product holds in a language', async () => {
      const source = await insertProduct('Duplicate source', k('dup-source'), [chA]);
      const holder = await insertProduct('Copy holder', k('dup-holder'), [chB]);
      await putOk(holder, { languageKeys: [{ languageCode: 'pl-PL', key: `${k('dup-source')}-copy` }] });
      const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${source}/duplicate`, ...admin });
      expect(res.statusCode, res.body).toBe(201);
      const dup = (res.json() as { data: { id: string; slug: string } }).data;
      products.push(dup.id);
      expect(dup.slug).not.toBe(`${k('dup-source')}-copy`);
      expect(dup.slug).toBe(`${k('dup-source')}-copy-2`);
    });
  });

  // T105a — the scope overview offers to delete orphaned channel × language keys.
  it('T105a: deletes an orphaned channel × language key (channel left, language dropped), keeping it as a redirect', async () => {
    const own = await insertChannel(['pl-PL', 'de-DE']);
    const p = await insertProduct('Orphan keys', k('orphan-keys'), [own]);
    await putOk(p, {
      channelKeys: [
        { channelId: own, languageCode: 'pl-PL', key: k('orphan-pl') },
        { channelId: own, languageCode: 'de-DE', key: k('orphan-de') },
      ],
    });
    // The channel drops de-DE: the (own, de-DE) key is orphaned.
    await h.em().getConnection().execute(`update sales_channels set languages = '["pl-PL"]'::jsonb where id = ?`, [own]);
    const write = await put(p, { channelKeys: [{ channelId: own, languageCode: 'de-DE', key: k('orphan-de-2') }] });
    expect(write.statusCode).toBe(422);
    expect((write.json() as ErrorBody).error).toMatchObject({ code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'language_not_offered' } });
    await putOk(p, { channelKeys: [{ channelId: own, languageCode: 'de-DE', key: null }] });

    // The product leaves the channel: the (own, pl-PL) key is orphaned.
    await h.em().getConnection().execute(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [own, p]);
    const write2 = await put(p, { channelKeys: [{ channelId: own, languageCode: 'pl-PL', key: k('orphan-pl-2') }] });
    expect(write2.statusCode).toBe(422);
    expect((write2.json() as ErrorBody).error).toMatchObject({ code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'not_a_member' } });
    await putOk(p, { channelKeys: [{ channelId: own, languageCode: 'pl-PL', key: null }] });

    expect(await keysOf(p)).toEqual([]);
    // Q3b — a removed key stays a redirect in its language until an operator deletes it.
    expect(tag(await redirectsOf(p))).toEqual([`de-DE:${k('orphan-de')}`, `pl-PL:${k('orphan-pl')}`]);
  });
});
