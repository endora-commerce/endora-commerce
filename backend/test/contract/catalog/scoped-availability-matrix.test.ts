import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { errorBodyOf } from '../../helpers/product-scope-fixture.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 163, Phase 5 (T031) — the Independent Test of US1: one product, two
 * channels × two languages, overrides at the channel and at the channel ×
 * language scope, read through every catalogue surface a buyer reaches it by.
 *
 * Per (channel, language) pair the product must be on everywhere or off
 * everywhere: the listing, the facet counts, the product page, the quick search,
 * the links of another product naming it, and a bundle offering it as an option.
 * "Off" answers exactly what "absent" answers (one `PRODUCT_NOT_FOUND`, the same
 * body), so the reason is never disclosed.
 *
 * Also: a product with no scope rows inherits everywhere ("use inherited"); an
 * archived one answers 410 to a caller who may see it; an unresolvable channel
 * matches nothing (FR-007). Phase 9c (T156s, spec Session 2026-10-25): a member
 * switched off by its global status but not archived is plain off — the absent 404 —
 * wherever no narrower `active` override turns it on, and never answers 410; the 410
 * is an archived product's only, and only where it would be available to the caller
 * with the archive taken away.
 *
 * Phase 24 (T146): with `search` switched off the listing degrades to Postgres and
 * answers the same sets.
 *
 * Final QA Q-M4 (US3 #1–#3): U is public globally and restricted to organization X
 * on C1 by a channel audience override; C2 inherits the global audience. On C1 only X's
 * buyer lists and opens it — the anonymous reader and organization Y's buyer get the
 * absent answer — and on C2 all three do.
 *
 * Every fixture name carries a per-run token; the channels are this suite's own.
 */

const RUN = randomUUID().slice(0, 8);
const ADMIN = { b2b_session: 'stub-admin-session' };
const BUYER = { b2b_session: 'stub-customer-session' };
/** Organization Y's buyer (`OTHER_TEST_ORGANIZATION_ID`); X is `BUYER`'s `TEST_ORGANIZATION_ID`. */
const OTHER_ORG_BUYER = { b2b_session: 'stub-customer-session-other-org' };
const LANGUAGES = ['pl-PL', 'en-US'] as const;
type Language = (typeof LANGUAGES)[number];

interface Channel {
  id: string;
  code: string;
}

describe('163 — scoped availability on every catalogue read [contract]', () => {
  let h: BackendServerHandle;
  let c1: Channel;
  let c2: Channel;
  const ids: Record<string, string> = {};
  const slugs: Record<string, string> = {};
  let facetKey: string | null = null;
  const facetValue = `scoped-${RUN}`;
  let bundle: { slotId: string; optionId: string } | null = null;

  async function sql(query: string, params: unknown[] = []): Promise<void> {
    await h.orm.em.getConnection().execute(query, params);
  }

  async function insertChannel(label: string): Promise<Channel> {
    const id = randomUUID();
    const code = `s163-${RUN}-${label}`;
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'pl-PL', '["pl-PL","en-US"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `163 matrix ${label}` })],
    );
    // Feature 154 — the signed-in buyer shops here only if its Organization is assigned.
    await sql(
      `insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)
       on conflict do nothing`,
      [id, TEST_ORGANIZATION_ID],
    );
    return { id, code };
  }

  async function insertProduct(
    key: string,
    fields: { status?: string; type?: string; archived?: boolean; noFacet?: boolean; channels: Channel[] },
  ): Promise<void> {
    const id = randomUUID();
    const sku = `S163-${RUN}-${key}`.toUpperCase();
    const attributeValues = facetKey && !fields.noFacet ? { [facetKey]: facetValue } : {};
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, attribute_values, visibility,
                             allowed_organization_ids, archived_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, '', ?::jsonb, 'public', '[]'::jsonb, ?, now(), now())`,
      [
        id,
        sku,
        sku.toLowerCase(),
        fields.type ?? 'simple',
        fields.status ?? 'active',
        `Matrix ${key}`,
        JSON.stringify(attributeValues),
        fields.archived ? new Date() : null,
      ],
    );
    for (const channel of fields.channels) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel.id, id]);
    }
    ids[key] = id;
    slugs[key] = sku.toLowerCase();
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    // Organization Y exists before any request, so no empty permitted-channel set is
    // cached for its buyer (feature 154).
    await seedOtherTestOrganization(h.em());
    // A filterable option-style attribute to count facets on.
    const filters = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters' });
    const defs = (filters.json() as { data: Array<{ attributeKey: string; valueType: string }> }).data;
    // The seed's filterable attributes are `enum` (`color`, `material`); every
    // option-style type is counted the same way (`getFilterDefinitions`).
    const optionStyle = new Set(['enum', 'select', 'string']);
    facetKey = defs.find((d) => optionStyle.has(d.valueType))?.attributeKey ?? null;

    c1 = await insertChannel('c1');
    c2 = await insertChannel('c2');

    // P — on at (C1, pl-PL) and (C2, pl-PL) only:
    //   C1 inherits global `active`, but C1 × en-US is `inactive`;
    //   C2 is `inactive`, but C2 × pl-PL is `active`.
    await insertProduct('p', { channels: [c1, c2] });
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now()), (?, ?, 'pl-PL', 'active', now(), now())`,
      [ids['p'], c1.id, ids['p'], c2.id],
    );
    await sql(
      `insert into product_channel_scopes (product_id, sales_channel_id, status, created_at, updated_at)
       values (?, ?, 'inactive', now(), now())`,
      [ids['p'], c2.id],
    );
    // Q — no scope rows: inherits `active` everywhere.
    await insertProduct('q', { channels: [c1, c2] });
    // U (Q-M4, US3) — public globally; C1's audience override admits organization X
    // only. Carries no facet value, so the facet counts below stay P's and Q's.
    await insertProduct('u', { noFacet: true, channels: [c1, c2] });
    await sql(
      `insert into product_channel_scopes (product_id, sales_channel_id, visibility, allowed_organization_ids, created_at, updated_at)
       values (?, ?, 'organization_restricted', ?::jsonb, now(), now())`,
      [ids['u'], c1.id, JSON.stringify([TEST_ORGANIZATION_ID])],
    );
    for (const channel of [c1, c2]) {
      await sql(
        `insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?)
         on conflict do nothing`,
        [channel.id, OTHER_TEST_ORGANIZATION_ID],
      );
    }
    // O — a member switched off by its global status (not archived); its PDP answer
    // is Phase 9c's (T156s). A — archived.
    await insertProduct('off', { status: 'inactive', channels: [c1, c2] });
    await insertProduct('a', { status: 'inactive', archived: true, channels: [c1, c2] });
    // S — names P as related; B — a bundle offering P.
    await insertProduct('s', { channels: [c1, c2] });
    await insertProduct('b', { type: 'bundle', channels: [c1, c2] });
    await sql(
      `insert into product_links (id, source_product_id, target_product_id, kind, position, created_at, updated_at)
       values (?, ?, ?, 'related', 0, now(), now()), (?, ?, ?, 'related', 1, now(), now())`,
      [randomUUID(), ids['s'], ids['p'], randomUUID(), ids['s'], ids['q']],
    );
    const slotId = randomUUID();
    const optionId = randomUUID();
    await sql(
      `insert into bundle_slots (id, parent_product_id, name, min_quantity, max_quantity, position, created_at, updated_at)
       values (?, ?, '{"en-US":"Pick"}'::jsonb, 1, 3, 0, now(), now())`,
      [slotId, ids['b']],
    );
    await sql(
      `insert into bundle_slot_options (id, slot_id, option_product_id, default_quantity, position, created_at, updated_at)
       values (?, ?, ?, 1, 0, now(), now())`,
      [optionId, slotId, ids['p']],
    );
    bundle = { slotId, optionId };
  });

  afterAll(async () => {
    if (h) {
      const all = Object.values(ids);
      if (all.length > 0) {
        const list = all.map(() => '?').join(',');
        await sql(`delete from bundle_slot_options where option_product_id in (${list})`, all);
        await sql(`delete from bundle_slots where parent_product_id in (${list})`, all);
        await sql(`delete from product_links where source_product_id in (${list})`, all);
        await sql(`delete from sales_channel_products where product_id in (${list})`, all);
        await sql(`delete from products where id in (${list})`, all);
      }
      for (const channel of [c1, c2]) {
        if (!channel) continue;
        await sql(`delete from sales_channel_organizations where sales_channel_id = ?`, [channel.id]);
        await sql(`delete from sales_channels where id = ?`, [channel.id]);
      }
      await teardownBackendServer(h);
    }
  });

  const headers = (channel: Channel, language: Language) => ({
    'x-sales-channel': channel.code,
    'accept-language': language,
  });

  /** On at (C, L) — the spec of the fixture above. */
  const pOn = (channel: Channel, language: Language): boolean => language === 'pl-PL' && (channel === c1 || channel === c2);

  const pairs = (): Array<[Channel, Language]> =>
    [c1, c2].flatMap((c) => LANGUAGES.map((l) => [c, l] as [Channel, Language]));

  it('lists P exactly where it is on, and Q (inherited) everywhere', async () => {
    for (const [channel, language] of pairs()) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-${RUN}`)}&limit=50`,
        headers: headers(channel, language),
      });
      expect(res.statusCode).toBe(200);
      const listed = (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
      expect(listed.includes(ids['p']!), `P listed at ${channel.code}/${language}`).toBe(pOn(channel, language));
      expect(listed, `Q inherits at ${channel.code}/${language}`).toContain(ids['q']);
      expect(listed, 'a member switched off is never listed').not.toContain(ids['off']);
      expect(listed, 'an archived product is never listed').not.toContain(ids['a']);
    }
  });

  it('US3: a channel audience override admits organization X on C1 only; C2 inherits the public rule', async () => {
    const readers: Array<[string, Record<string, string> | undefined]> = [
      ['anonymous', undefined],
      ['organization X', BUYER],
      ['organization Y', OTHER_ORG_BUYER],
    ];
    const absentSlug = `s163-${RUN}-absent`;
    for (const channel of [c1, c2]) {
      for (const [reader, cookies] of readers) {
        const admitted = channel === c2 || reader === 'organization X';
        const where = `${reader} on ${channel === c1 ? 'C1 (B2B override)' : 'C2 (inherits public)'}`;
        const list = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-${RUN}`)}&limit=50`,
          headers: headers(channel, 'pl-PL'),
          ...(cookies ? { cookies } : {}),
        });
        expect(list.statusCode, `${where}: ${list.body}`).toBe(200);
        const listed = (list.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
        expect(listed.includes(ids['u']!), `U listed for ${where}`).toBe(admitted);
        expect(listed, `Q listed for ${where}`).toContain(ids['q']);

        const page = (slug: string) =>
          h.app.inject({
            method: 'GET',
            url: `/api/v1/catalog/products/${slug}`,
            headers: headers(channel, 'pl-PL'),
            ...(cookies ? { cookies } : {}),
          });
        const res = await page(slugs['u']!);
        if (admitted) {
          expect(res.statusCode, `U's page for ${where}`).toBe(200);
        } else {
          const absent = await page(absentSlug);
          expect(res.statusCode, `U's page for ${where}`).toBe(404);
          expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
        }
      }
    }
  });

  // Phase 24 (T146, Constitution XVII) — `search` off. The listing's degrade path is
  // the Postgres read, and it must narrow by the same availability predicate (rows
  // 1–2 of `contracts/consumers.md`): the index is not what makes P disappear. The
  // harness pins the listing to Postgres for every file, so the case asks for the
  // index explicitly — with `search` present a phrase would go to Meilisearch — and
  // then switches `search` off on the operator axis.
  it('T146: with search off, the Postgres listing and the facets apply the same predicate', async () => {
    const pinned = process.env['CATALOG_SEARCH_BACKEND'];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    try {
      await withModuleOff('search', 'deactivated', async () => {
        for (const [channel, language] of pairs()) {
          const res = await h.app.inject({
            method: 'GET',
            url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-${RUN}`)}&limit=50`,
            headers: headers(channel, language),
          });
          expect(res.statusCode, `listing at ${channel.code}/${language}`).toBe(200);
          expect(res.headers['x-search-backend'], 'search off degrades to Postgres').toBe('postgres');
          const listed = (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
          expect(listed.includes(ids['p']!), `P listed at ${channel.code}/${language}`).toBe(pOn(channel, language));
          expect(listed, `Q inherits at ${channel.code}/${language}`).toContain(ids['q']);
          expect(listed).not.toContain(ids['off']);
          expect(listed).not.toContain(ids['a']);

          if (!facetKey) throw new Error('the seed provides no filterable option-style attribute');
          const filters = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: headers(channel, language) });
          expect(filters.statusCode).toBe(200);
          const def = (
            filters.json() as { data: Array<{ attributeKey: string; options?: Array<{ value: string; count: number }> }> }
          ).data.find((d) => d.attributeKey === facetKey);
          const option = def?.options?.find((o) => o.value === facetValue);
          if (!option) throw new Error(`no facet option ${facetValue} at ${channel.code}/${language}`);
          expect(option.count, `facet count at ${channel.code}/${language}`).toBe(3 + (pOn(channel, language) ? 1 : 0));
        }
      });
    } finally {
      if (pinned === undefined) delete process.env['CATALOG_SEARCH_BACKEND'];
      else process.env['CATALOG_SEARCH_BACKEND'] = pinned;
    }
  });

  it('counts P in the facets exactly where it is on', async () => {
    if (!facetKey) throw new Error('the seed provides no filterable option-style attribute');
    for (const [channel, language] of pairs()) {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: headers(channel, language) });
      expect(res.statusCode).toBe(200);
      const def = (res.json() as { data: Array<{ attributeKey: string; options?: Array<{ value: string; count: number }> }> }).data.find(
        (d) => d.attributeKey === facetKey,
      );
      const option = def?.options?.find((o) => o.value === facetValue);
      if (!option) throw new Error(`no facet option ${facetValue} at ${channel.code}/${language}`);
      // Q, S, B are on everywhere and carry the value; P only where on.
      expect(option.count, `facet count at ${channel.code}/${language}`).toBe(3 + (pOn(channel, language) ? 1 : 0));
    }
  });

  it('serves P’s page where it is on and answers the absent product’s 404 elsewhere', async () => {
    for (const [channel, language] of pairs()) {
      // Asked at the same (channel, language): the message is localised.
      const absent = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/does-not-exist-${RUN}`,
        headers: headers(channel, language),
      });
      expect(absent.statusCode).toBe(404);
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${slugs['p']}`,
        headers: headers(channel, language),
      });
      if (pOn(channel, language)) {
        expect(res.statusCode, `PDP at ${channel.code}/${language}`).toBe(200);
      } else {
        expect(res.statusCode, `PDP at ${channel.code}/${language}`).toBe(404);
        // Same body as a product that does not exist: no reason leaks.
        expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
      }
    }
  });

  it('an archived product answers 410 by slug where it would otherwise be on', async () => {
    const archived = await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${slugs['a']}`, headers: headers(c1, 'pl-PL') });
    expect(archived.statusCode).toBe(410);
  });

  it('an archived product that would not be available here anyway answers the absent product’s 404, not 410', async () => {
    // Security review (checkpoint B) — the 410 discloses "this was here"; it is
    // answered only where the product would be available with the archive taken
    // away. AW is archived and its window has also ended; AL is archived and
    // switched off in C1 × en-US.
    await insertProduct('aw', { status: 'inactive', archived: true, channels: [c1, c2] });
    await sql(`update products set publish_until = ? where id = ?`, [new Date(Date.now() - 60_000), ids['aw']]);
    await insertProduct('al', { status: 'inactive', archived: true, channels: [c1, c2] });
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'en-US', 'inactive', now(), now())`,
      [ids['al'], c1.id],
    );
    try {
      for (const [slug, language] of [[slugs['aw']!, 'pl-PL'], [slugs['al']!, 'en-US']] as const) {
        const absent = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products/does-not-exist-${RUN}`,
          headers: headers(c1, language),
        });
        const res = await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${slug}`, headers: headers(c1, language) });
        expect(res.statusCode, `${slug} at ${language}`).toBe(404);
        expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
      }
      // The same archived product where it would be on still answers 410.
      const elsewhere = await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${slugs['al']}`, headers: headers(c1, 'pl-PL') });
      expect(elsewhere.statusCode).toBe(410);
    } finally {
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [ids['al']]);
    }
  });

  // Phase 9c (T156s, FR-005, FR-010, O-3, O-4) — the product page's "gone" answer.
  it('T156s: a member switched off globally but not archived is off wherever no override turns it on, and never answers 410', async () => {
    // OFF is `inactive` globally; C1 says `active`, and so does C2 × pl-PL. A narrower
    // override wins (FR-008, FR-010: `inactive` means off *there*), so OFF is on at
    // (C1, *) and (C2, pl-PL) and plain off — the absent product's 404 — at (C2, en-US).
    // Not archived, so no pair answers 410.
    await sql(
      `insert into product_channel_scopes (product_id, sales_channel_id, status, created_at, updated_at)
       values (?, ?, 'active', now(), now())`,
      [ids['off'], c1.id],
    );
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       values (?, ?, 'pl-PL', 'active', now(), now())`,
      [ids['off'], c2.id],
    );
    const offOn = (channel: Channel, language: Language): boolean => channel === c1 || language === 'pl-PL';
    try {
      for (const [channel, language] of pairs()) {
        const absent = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products/does-not-exist-${RUN}`,
          headers: headers(channel, language),
        });
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products/${slugs['off']}`,
          headers: headers(channel, language),
        });
        expect(res.statusCode, `OFF at ${channel.code}/${language}`).not.toBe(410);
        if (offOn(channel, language)) {
          expect(res.statusCode, `OFF at ${channel.code}/${language}`).toBe(200);
        } else {
          expect(res.statusCode, `OFF at ${channel.code}/${language}`).toBe(404);
          expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
        }
      }
      // Without its overrides OFF is off at every pair: the absent 404, never 410.
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [ids['off']]);
      await sql(`delete from product_channel_scopes where product_id = ?`, [ids['off']]);
      for (const [channel, language] of pairs()) {
        const absent = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products/does-not-exist-${RUN}`,
          headers: headers(channel, language),
        });
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/catalog/products/${slugs['off']}`,
          headers: headers(channel, language),
        });
        expect(res.statusCode, `bare OFF at ${channel.code}/${language}`).toBe(404);
        expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
      }
    } finally {
      await sql(`delete from product_channel_language_scopes where product_id = ?`, [ids['off']]);
      await sql(`delete from product_channel_scopes where product_id = ?`, [ids['off']]);
    }
  });

  it('T156s: an archived product with no overrides answers 410 at every (C, L) of its channels, naming PRODUCT_ARCHIVED', async () => {
    for (const [channel, language] of pairs()) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${slugs['a']}`,
        headers: headers(channel, language),
      });
      expect(res.statusCode, `A at ${channel.code}/${language}`).toBe(410);
      const error = (res.json() as { error: { code: string; message: string } }).error;
      expect(error.code).toBe('PRODUCT_ARCHIVED');
      if (language === 'en-US') expect(error.message).toBe('Product is archived.');
    }
  });

  it('T156s: an archived product outside the caller’s audience answers the absent 404', async () => {
    await insertProduct('ar', { status: 'inactive', archived: true, channels: [c1, c2] });
    await sql(
      `update products set visibility = 'organization_restricted', allowed_organization_ids = ?::jsonb where id = ?`,
      [JSON.stringify([TEST_ORGANIZATION_ID]), ids['ar']],
    );
    const absent = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/does-not-exist-${RUN}`,
      headers: headers(c1, 'pl-PL'),
    });
    const anonymous = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${slugs['ar']}`,
      headers: headers(c1, 'pl-PL'),
    });
    expect(anonymous.statusCode).toBe(404);
    expect(errorBodyOf(anonymous)).toEqual(errorBodyOf(absent));
    // Its organisation's buyer, who could see it were it not archived, is told it is gone.
    const member = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${slugs['ar']}`,
      headers: headers(c1, 'pl-PL'),
      cookies: BUYER,
    });
    expect(member.statusCode).toBe(410);
  });

  it('shows P among S’s links only where P is on', async () => {
    for (const [channel, language] of pairs()) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products/${slugs['s']}/links`,
        headers: headers(channel, language),
      });
      expect(res.statusCode).toBe(200);
      const targets = (res.json() as { data: Array<{ product: { id: string } }> }).data.map((l) => l.product.id);
      expect(targets.includes(ids['p']!), `link to P at ${channel.code}/${language}`).toBe(pOn(channel, language));
      expect(targets).toContain(ids['q']);
    }
  });

  it('accepts P as a bundle option only where P is on', async () => {
    for (const [channel, language] of pairs()) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/catalog/products/${slugs['b']}/bundle-configuration/validate`,
        headers: headers(channel, language),
        payload: { selections: [{ slotId: bundle!.slotId, optionId: bundle!.optionId, quantity: 1 }] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { valid: boolean; errors: Array<{ code: string }> } };
      expect(body.data.valid, `bundle with P at ${channel.code}/${language}`).toBe(pOn(channel, language));
      if (!pOn(channel, language)) {
        // The answer an absent option gets — never a reason.
        expect(body.data.errors.map((e) => e.code)).toContain('UNKNOWN_OPTION');
      }
    }
  });

  it('finds P in the quick search only where it is on', async () => {
    for (const [channel, language] of pairs()) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/quick-order/search?q=${encodeURIComponent(`S163-${RUN}`)}&limit=50`,
        headers: headers(channel, language),
        cookies: BUYER,
      });
      expect(res.statusCode).toBe(200);
      const hits = (res.json() as { data: Array<{ productId: string }> }).data.map((hit) => hit.productId);
      expect(hits.includes(ids['p']!), `quick search at ${channel.code}/${language}`).toBe(pOn(channel, language));
      expect(hits).toContain(ids['q']);
      expect(hits).not.toContain(ids['off']);
    }
  });

  it('matches nothing on a channel code no channel has (FR-007)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-${RUN}`)}`,
      headers: { 'x-sales-channel': `no-such-${RUN}`, 'accept-language': 'pl-PL' },
    });
    if (res.statusCode === 200) {
      const listed = (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
      expect(listed).not.toContain(ids['p']);
      expect(listed).not.toContain(ids['q']);
    } else {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('keeps ADMIN reads unaffected (the admin session is not a buyer)', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${ids['off']}`, cookies: ADMIN });
    expect(res.statusCode).toBe(200);
  });
});
