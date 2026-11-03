import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 18 (T114a, analyze C1) — SEO override writes are Commands
 * (`specs/163-product-data-scopes/contracts/seo-media-attachments.md` §1, research
 * R13, R29; Constitution XIII, FR-080).
 *
 * - `PUT /api/v1/admin/seo/meta/:entityType/:entityId` writes exactly one audit row
 *   per request, action `seo_meta_override.upsert`: `before` is the full previous
 *   row projection on an update (never `null` there) and `null` on a create,
 *   `after` the full projection;
 * - `DELETE` writes one `seo_meta_override.delete` row with the deleted projection
 *   as `before`, and none when nothing was deleted;
 * - a row is addressed by (entity, `channelId?`, `locale?`): DELETE removes exactly
 *   the addressed language, channel or channel × language row; naming neither
 *   keeps today's meaning, `locale = 'en-US'`;
 * - re-sending `before` restores the row (R29 — no single-write undo);
 * - the write and its audit roll back together.
 *
 * The product and channel are this suite's own (per-run names).
 */
describe('SEO meta overrides as Commands (spec 163, T114a)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  let productId: string;
  let channelId: string;

  interface AuditRow {
    object_id: string;
    state_before: Record<string, unknown> | null;
    state_after: Record<string, unknown> | null;
  }
  interface OverrideRow {
    sales_channel_id: string | null;
    locale: string | null;
    title: string | null;
    description: string | null;
  }

  const url = (query = ''): string => `/api/v1/admin/seo/meta/product/${productId}${query}`;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function auditRows(action: string): Promise<AuditRow[]> {
    return sql<AuditRow[]>(
      `select object_id, state_before, state_after from audit_log_entries
        where action = ? and object_type = 'seo_meta_override'
          and (state_before->>'entityId' = ? or state_after->>'entityId' = ?)
        order by acted_at`,
      [action, productId, productId],
    );
  }

  async function overrides(): Promise<OverrideRow[]> {
    return sql<OverrideRow[]>(
      `select sales_channel_id, locale, title, description from seo_meta_overrides
        where entity_type = 'product' and entity_id = ?
        order by sales_channel_id nulls first, locale nulls first`,
      [productId],
    );
  }

  const put = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PUT', url: url(), ...admin, payload });
  const del = (query: string) => h.app.inject({ method: 'DELETE', url: url(query), ...admin });

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = randomUUID();
    productId = randomUUID();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, '{"en-US":"163 seo commands"}'::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb,
               'PLN', true, now(), now())`,
      [channelId, `sc163-${run}`],
    );
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', 'Seo command', null, now(), now())`,
      [productId, `SC163-${run}`, `seo-command-${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      await sql(`delete from sales_channels where id = ?`, [channelId]);
      await teardownBackendServer(h);
    }
  });

  const projection = (fields: Record<string, unknown>) => ({
    entityType: 'product',
    entityId: productId,
    channelId: null,
    locale: 'en-US',
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
    ...fields,
  });

  it('a create is one upsert row with `before: null` and the full projection after', async () => {
    const res = await put({ locale: 'en-US', title: 'First title' });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await auditRows('seo_meta_override.upsert');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state_before).toBeNull();
    expect(rows[0]!.state_after).toEqual(projection({ title: 'First title' }));
  });

  it('an update is one upsert row whose `before` is the full previous projection', async () => {
    const res = await put({ locale: 'en-US', description: 'Added description' });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await auditRows('seo_meta_override.upsert');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.state_before).toEqual(projection({ title: 'First title' }));
    expect(rows[1]!.state_after).toEqual(projection({ title: 'First title', description: 'Added description' }));
  });

  it('re-sending `before` restores the row (R29)', async () => {
    const [, update] = await auditRows('seo_meta_override.upsert');
    const before = update!.state_before!;
    const res = await put({
      locale: before['locale'],
      title: before['title'],
      description: before['description'],
      ogTitle: before['ogTitle'],
      ogDescription: before['ogDescription'],
      ogImageUrl: before['ogImageUrl'],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await overrides()).toEqual([
      { sales_channel_id: null, locale: 'en-US', title: 'First title', description: null },
    ]);
  });

  it('naming neither a channel nor a locale addresses the en-US row, as before', async () => {
    const res = await put({ title: 'Default address' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await overrides()).toEqual([
      { sales_channel_id: null, locale: 'en-US', title: 'Default address', description: null },
    ]);
  });

  it('DELETE removes exactly the addressed row and audits it; deleting nothing writes no row', async () => {
    expect((await put({ locale: 'pl-PL', title: 'L row' })).statusCode).toBe(200);
    expect((await put({ channelId, title: 'C row' })).statusCode).toBe(200);
    expect((await put({ channelId, locale: 'pl-PL', title: 'CxL row' })).statusCode).toBe(200);

    const deletesBefore = (await auditRows('seo_meta_override.delete')).length;
    const res = await del(`?channelId=${channelId}`);
    expect(res.statusCode, res.body).toBe(204);
    expect((await overrides()).map((row) => [row.sales_channel_id, row.locale, row.title])).toEqual([
      [null, 'en-US', 'Default address'],
      [null, 'pl-PL', 'L row'],
      [channelId, 'pl-PL', 'CxL row'],
    ]);
    const deletes = await auditRows('seo_meta_override.delete');
    expect(deletes).toHaveLength(deletesBefore + 1);
    expect(deletes.at(-1)!.state_before).toEqual(projection({ channelId, locale: null, title: 'C row' }));
    expect(deletes.at(-1)!.state_after).toBeNull();

    // Nothing at that address any more: 204, and no audit row.
    const again = await del(`?channelId=${channelId}`);
    expect(again.statusCode).toBe(204);
    expect(await auditRows('seo_meta_override.delete')).toHaveLength(deletesBefore + 1);

    expect((await del(`?channelId=${channelId}&locale=pl-PL`)).statusCode).toBe(204);
    expect((await del('?locale=pl-PL')).statusCode).toBe(204);
    expect((await overrides()).map((row) => row.title)).toEqual(['Default address']);
  });

  it('rolls the write and its audit back together', async () => {
    const upserts = (await auditRows('seo_meta_override.upsert')).length;
    const snapshot = await overrides();
    // Past the column's width: the schema takes any URL, the table refuses it.
    const res = await put({ locale: 'en-US', ogImageUrl: `https://img.test/${'a'.repeat(3000)}` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await overrides()).toEqual(snapshot);
    expect(await auditRows('seo_meta_override.upsert')).toHaveLength(upserts);
  });
});
