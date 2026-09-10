import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #200 — a write inside `em.transactional(...)` has to roll back with it.
 *
 * `BlogCategoryService.create` wraps its four statements in one transaction and
 * the last of them can fail on a foreign key: a `salesChannelIds` entry naming
 * a channel that does not exist. Everything the transaction did before that
 * point must be gone afterwards.
 *
 * It was not. Every statement in the service ran through
 * `tx.getConnection().execute(sql, params)`, and a connection-level `execute`
 * with no transaction context takes its own pooled connection — so the
 * `blog_categories` insert committed the moment it ran and survived the
 * rollback as a category with no channel scope, invisible to every listing
 * that joins the bridge and undeletable through the admin UI.
 */
describe('blog writes are atomic with their transaction (issue #200)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const rows = (await h.em().execute(sql, params)) as Array<{ n: number }>;
    const [row] = rows;
    // No `?? 0`: a count query that answered nothing is a broken query, not a
    // zero, and the difference is what `check:fixture-substitution` exists for.
    if (!row) throw new Error(`count query returned no row: ${sql}`);
    return row.n;
  }

  function countCategories(slug: string): Promise<number> {
    return countRows(`select count(*)::int as n from blog_categories where slug = ?`, [slug]);
  }

  it('leaves no category row behind when the channel-scope insert fails', async () => {
    const slug = `atomicity-${Date.now()}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': slug },
        slug,
        // A well-formed uuid that names no sales channel — the bridge insert
        // is refused by `blog_category_sales_channels`' foreign key.
        salesChannelIds: [randomUUID()],
        languages: ['en-US'],
        enabled: true,
      }),
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countCategories(slug)).toBe(0);
  });

  it('still commits the whole category when every statement succeeds', async () => {
    const slug = `atomicity-ok-${Date.now()}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        enabled: true,
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(await countCategories(slug)).toBe(1);
    const scoped = await countRows(
      `select count(*)::int as n
         from blog_category_sales_channels bcs
         join blog_categories bc on bc.id = bcs.blog_category_id
        where bc.slug = ?`,
      [slug],
    );
    expect(scoped).toBe(1);
  });
});
