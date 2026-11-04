import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SeoProductMetaWritePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T119; FR-091, `contracts/seo-ports.md` §2,
 * research R9, R21) — `seoProductMetaWritePort`:
 *
 * - `applyWithin` writes on the **caller's** EntityManager: no flush, no audit entry, and the rows
 *   commit or roll back with the caller's transaction;
 * - every scope is writable — Global, Channel and Channel × language — whatever the product's
 *   memberships say: the scope check is the caller's (catalog's save, a duplicate made in the same
 *   transaction);
 * - `set` stores the value, `empty` stores `''`, `inherit` stores `NULL`, and a row left all `NULL`
 *   is deleted;
 * - refusals (`422 SCOPED_VALUE_INVALID`): `inherit` at Global, an over-long value, an image URL
 *   that is not `http(s)` (`javascript:`, `data:`) or that carries credentials;
 * - `readWithin` answers one entry per named field, `own` never `null`.
 */
describe('172 — seo product metadata write port [contract]', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const productId = randomUUID();
  const channelId = randomUUID();
  const port = () => h.container.resolve<SeoProductMetaWritePort<EntityManager>>('seoProductMetaWritePort');

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }
  const rows = () =>
    sql<Array<{ sales_channel_id: string | null; locale: string | null; title: string | null; description: string | null; og_image_url: string | null }>>(
      `select sales_channel_id, locale, title, description, og_image_url from seo_meta_overrides
        where entity_type = 'product' and entity_id = ? order by sales_channel_id nulls first, locale nulls first`,
      [productId],
    );
  const audits = () =>
    sql<Array<{ id: string }>>(
      `select id from audit_log_entries where object_type = 'seo_meta_override' and (state_after->>'entityId' = ? or state_before->>'entityId' = ?)`,
      [productId, productId],
    );

  const G = { level: 'global' } as const;
  const C = () => ({ level: 'channel', channelId }) as const;
  const CL = () => ({ level: 'channel_language', channelId, languageCode: 'pl-PL' }) as const;

  beforeAll(async () => {
    h = await setupBackendServer();
    // A channel the product is NOT a member of: the port writes any scope it is given.
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency, active, created_at, updated_at)
       values (?, ?, '{"en-US":"172 seo port"}'::jsonb, 'pl-PL', '["pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [channelId, `sc170p-${run}`],
    );
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', 'Seo port', null, now(), now())`,
      [productId, `SEO170P-${run}`, `seo-port-${run}`],
    );
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
    await sql(`delete from products where id = ?`, [productId]);
    await sql(`delete from sales_channels where id = ?`, [channelId]);
    await teardownBackendServer(h);
  });

  it('writes Global, Channel and Channel x language rows inside the caller transaction, without audit', async () => {
    const auditsBefore = (await audits()).length;
    await h.em().fork().transactional(async (em) => {
      const g = await port().applyWithin(em, { productId, scope: G, changes: { title: { op: 'set', value: 'Global title' } } });
      expect(g.before).toEqual({ title: { inherited: true } });
      expect(g.after).toEqual({ title: { own: 'Global title' } });
      await port().applyWithin(em, { productId, scope: C(), changes: { description: { op: 'empty' } } });
      await port().applyWithin(em, {
        productId,
        scope: CL(),
        changes: { title: { op: 'set', value: 'Tytuł' }, ogImageUrl: { op: 'set', value: 'https://cdn.test/og.png' } },
      });
      // Not visible outside the caller's transaction before it commits.
      expect(await rows()).toEqual([]);
    });
    expect(await rows()).toEqual([
      { sales_channel_id: null, locale: null, title: 'Global title', description: null, og_image_url: null },
      { sales_channel_id: channelId, locale: null, title: null, description: '', og_image_url: null },
      { sales_channel_id: channelId, locale: 'pl-PL', title: 'Tytuł', description: null, og_image_url: 'https://cdn.test/og.png' },
    ]);
    expect(await audits()).toHaveLength(auditsBefore);
  });

  it('reads the own values at a scope: a text, an empty override, or none', async () => {
    const em = h.em().fork();
    expect(await port().readWithin(em, { productId, scope: C(), fields: ['title', 'description'] })).toEqual({
      title: { inherited: true },
      description: { own: { empty: true } },
    });
    expect(await port().readWithin(em, { productId, scope: CL(), fields: ['title'] })).toEqual({ title: { own: 'Tytuł' } });
  });

  it('rolls its rows back with the caller', async () => {
    const before = await rows();
    await expect(
      h.em().fork().transactional(async (em) => {
        await port().applyWithin(em, { productId, scope: G, changes: { description: { op: 'set', value: 'Rolled back' } } });
        throw new Error('caller fails after the SEO write');
      }),
    ).rejects.toThrow('caller fails after the SEO write');
    expect(await rows()).toEqual(before);
  });

  it('deletes a row whose every column is inherited', async () => {
    await h.em().fork().transactional(async (em) => {
      await port().applyWithin(em, { productId, scope: C(), changes: { description: { op: 'inherit' } } });
    });
    expect((await rows()).map((r) => [r.sales_channel_id, r.locale])).toEqual([
      [null, null],
      [channelId, 'pl-PL'],
    ]);
  });

  it.each([
    ['inherit at Global', G, { title: { op: 'inherit' } }],
    ['a title over 160 characters', G, { title: { op: 'set', value: 'x'.repeat(161) } }],
    ['a description over 400 characters', G, { description: { op: 'set', value: 'x'.repeat(401) } }],
    ['a javascript: image URL', G, { ogImageUrl: { op: 'set', value: 'javascript:alert(1)' } }],
    ['a data: image URL', G, { ogImageUrl: { op: 'set', value: 'data:image/png;base64,AAAA' } }],
    ['an image URL with credentials', G, { ogImageUrl: { op: 'set', value: 'https://user:pass@evil.example/x.png' } }],
    ['an image URL over 2048 characters', G, { ogImageUrl: { op: 'set', value: `https://cdn.test/${'a'.repeat(2048)}` } }],
  ] as const)('refuses %s with 422 SCOPED_VALUE_INVALID and writes nothing', async (_name, scope, changes) => {
    const before = await rows();
    await expect(
      h.em().fork().transactional(async (em) => port().applyWithin(em, { productId, scope, changes })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'SCOPED_VALUE_INVALID' });
    expect(await rows()).toEqual(before);
  });
});
