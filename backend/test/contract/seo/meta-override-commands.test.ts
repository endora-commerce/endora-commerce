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
 * R13, R29; Constitution XIII, FR-080). Feature 172 moved product metadata to catalog's save
 * (`specs/172-product-editor-scope-switcher/contracts/seo-ports.md` §2, §4): the generic routes
 * refuse a product (`product-meta-read-relaxed.test.ts`) and the write port is tested in
 * `product-meta-write-port.test.ts`, so this suite holds the Command path on what still uses it,
 * a **category**'s language rows:
 *
 * - `PUT /api/v1/admin/seo/meta/:entityType/:entityId` writes exactly one audit row
 *   per request, action `seo_meta_override.upsert`: `before` is the full previous
 *   row projection on an update (never `null` there) and `null` on a create,
 *   `after` the full projection;
 * - `DELETE` writes one `seo_meta_override.delete` row with the deleted projection
 *   as `before`, and none when nothing was deleted;
 * - a category row is addressed by its locale; naming none is `locale = 'en-US'`; a channel is a
 *   product's alone (`422`);
 * - re-sending `before` restores the row (R29 — no single-write undo);
 * - a refused write leaves neither a row nor an audit entry.
 *
 * The category is this suite's own (per-run names).
 */
describe('SEO meta overrides as Commands (spec 163, T114a; category since 172)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  let categoryId: string;

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

  const url = (query = ''): string => `/api/v1/admin/seo/meta/category/${categoryId}${query}`;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function auditRows(action: string): Promise<AuditRow[]> {
    return sql<AuditRow[]>(
      `select object_id, state_before, state_after from audit_log_entries
        where action = ? and object_type = 'seo_meta_override'
          and (state_before->>'entityId' = ? or state_after->>'entityId' = ?)
        order by acted_at`,
      [action, categoryId, categoryId],
    );
  }

  async function overrides(): Promise<OverrideRow[]> {
    return sql<OverrideRow[]>(
      `select sales_channel_id, locale, title, description from seo_meta_overrides
        where entity_type = 'category' and entity_id = ?
        order by sales_channel_id nulls first, locale nulls first`,
      [categoryId],
    );
  }

  const put = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PUT', url: url(), ...admin, payload });
  const del = (query: string) => h.app.inject({ method: 'DELETE', url: url(query), ...admin });

  beforeAll(async () => {
    h = await setupBackendServer();
    categoryId = randomUUID();
    await sql(
      `insert into categories (id, name, slug, created_at, updated_at)
       values (?, '{"en-US":"Seo command"}'::jsonb, ?, now(), now())`,
      [categoryId, `seo-command-${run}`],
    );
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from seo_meta_overrides where entity_id = ?`, [categoryId]);
      await sql(`delete from categories where id = ?`, [categoryId]);
      await teardownBackendServer(h);
    }
  });

  const projection = (fields: Record<string, unknown>) => ({
    entityType: 'category',
    entityId: categoryId,
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

  it('naming no locale addresses the en-US row, and a channel is refused on a category', async () => {
    const res = await put({ title: 'Default address' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await overrides()).toEqual([
      { sales_channel_id: null, locale: 'en-US', title: 'Default address', description: null },
    ]);
    const channel = await put({ channelId: randomUUID(), title: 'C row' });
    expect(channel.statusCode, channel.body).toBe(422);
  });

  it('DELETE removes exactly the addressed row and audits it; deleting nothing writes no row', async () => {
    expect((await put({ locale: 'pl-PL', title: 'L row' })).statusCode).toBe(200);

    const deletesBefore = (await auditRows('seo_meta_override.delete')).length;
    const res = await del('?locale=pl-PL');
    expect(res.statusCode, res.body).toBe(204);
    expect((await overrides()).map((row) => [row.sales_channel_id, row.locale, row.title])).toEqual([
      [null, 'en-US', 'Default address'],
    ]);
    const deletes = await auditRows('seo_meta_override.delete');
    expect(deletes).toHaveLength(deletesBefore + 1);
    expect(deletes.at(-1)!.state_before).toEqual(projection({ locale: 'pl-PL', title: 'L row' }));
    expect(deletes.at(-1)!.state_after).toBeNull();

    // Nothing at that address any more: 204, and no audit row.
    const again = await del('?locale=pl-PL');
    expect(again.statusCode).toBe(204);
    expect(await auditRows('seo_meta_override.delete')).toHaveLength(deletesBefore + 1);
  });

  it('leaves neither a row nor an audit entry when a write is refused', async () => {
    const upserts = (await auditRows('seo_meta_override.upsert')).length;
    const snapshot = await overrides();
    const res = await put({ locale: 'en-US', ogImageUrl: `https://img.test/${'a'.repeat(3000)}` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await overrides()).toEqual(snapshot);
    expect(await auditRows('seo_meta_override.upsert')).toHaveLength(upserts);
  });
});
