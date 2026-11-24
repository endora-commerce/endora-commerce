import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NewsletterSubscriber } from '../../helpers/package-entities.js';
import { collectTiedPages, expectTiesInIdOrder, placeholders, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the admin subscribers list pages by offset, newest first, so
 * subscribers created in the same instant need `id` as the tie-breaker, or a
 * page boundary repeats one and skips another. An e-mail fragment isolates the
 * seeded subscribers.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/newsletter/subscribers — paging through equal creation times (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `ties-${randomUUID().slice(0, 8)}`;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const subscribers = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(NewsletterSubscriber, { email: `${marker}-${i}@example.com` } as never),
    );
    await em.persist(subscribers).flush();
    seededIds = subscribers.map((s) => (s as unknown as { id: string }).id);
    await em
      .getConnection()
      .execute(`update newsletter_subscribers set created_at = ? where id in (${placeholders(seededIds)})`, [
        '2001-02-03T04:05:06.000Z',
        ...seededIds,
      ]);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from newsletter_subscribers where id in (${placeholders(seededIds)})`, seededIds);
    }
    await teardownBackendServer(h);
  });

  it('sees every tied subscriber exactly once, ordered by id desc', async () => {
    const collected = await collectTiedPages(1, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/newsletter/subscribers?q=${marker}&page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: { items: Array<{ id: string }>; total: number } };
      expect(body.data.total).toBe(TIE_ROW_COUNT);
      return body.data.items.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, 'desc');
  });
});
