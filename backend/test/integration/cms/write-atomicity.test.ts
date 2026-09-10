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
 * `CmsPageService.create` inserts the page and then its channel-scope rows in
 * one transaction. Asking for two channels — one real, one that does not exist
 * — passes the language-scope guard (the real channel supplies the language)
 * and fails on the bridge table's foreign key, so the transaction rolls back.
 *
 * The page row used to survive that rollback: every statement ran through
 * `tx.getConnection().execute(sql, params)`, which takes its own pooled
 * connection and commits immediately. What was left behind was a page with no
 * channel scope — served nowhere, listed nowhere, and still holding its slug.
 */
describe('cms writes are atomic with their transaction (issue #200)', () => {
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

  async function countPages(slug: string): Promise<number> {
    const rows = (await h.em().execute(`select count(*)::int as n from cms_pages where slug = ?`, [
      slug,
    ])) as Array<{ n: number }>;
    const [row] = rows;
    // No `?? 0`: a count query that answered nothing is a broken query, not a
    // zero, and the difference is what `check:fixture-substitution` exists for.
    if (!row) throw new Error('count query returned no row');
    return row.n;
  }

  function createPage(slug: string, salesChannelIds: string[]): Promise<{ statusCode: number }> {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Atomicity ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds,
        languages: ['en-US'],
        meta: { 'en-US': { title: slug, description: slug, keywords: 'cms,atomicity' } },
      }),
    });
  }

  it('leaves no page row behind when the channel-scope insert fails', async () => {
    const slug = `cms-atomicity-${Date.now()}`;
    const res = await createPage(slug, [defaultChannelId, randomUUID()]);

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countPages(slug)).toBe(0);
  });

  it('still commits the whole page when every statement succeeds', async () => {
    const slug = `cms-atomicity-ok-${Date.now()}`;
    const res = await createPage(slug, [defaultChannelId]);

    expect(res.statusCode).toBe(201);
    expect(await countPages(slug)).toBe(1);
  });
});
