import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SalesChannel } from '@endora-commerce/platform/kernel';

import { collectTiedPages, expectTiesInIdOrder, placeholders, TIE_PAST, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the admin sales-channel list pages by offset, oldest first, so
 * channels created in the same instant need `id` as the tie-breaker, or a page
 * boundary repeats one channel and skips another. The seeded channels share a
 * creation time no other row holds, far in the past, so they lead the list.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/sales-channels — paging through equal creation times (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `ties_${randomUUID().slice(0, 8)}`;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(SalesChannel, {
        code: `${marker}_${i}`,
        name: { en: `Paging ties ${i}` },
        defaultLanguage: 'en',
        languages: ['en'],
        defaultCurrency: 'PLN',
        currencies: ['PLN'],
        active: false,
      }),
    );
    await em.persist(channels).flush();
    seededIds = channels.map((c) => c.id);
    await em
      .getConnection()
      .execute(`update sales_channels set created_at = ? where id in (${placeholders(seededIds)})`, [
        TIE_PAST,
        ...seededIds,
      ]);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h.em().getConnection().execute(`delete from sales_channels where id in (${placeholders(seededIds)})`, seededIds);
    }
    await teardownBackendServer(h);
  });

  it('sees every tied channel exactly once, ordered by id asc', async () => {
    const collected = await collectTiedPages(0, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/sales-channels?page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { items: Array<{ id: string }> }).items.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, 'asc');
  });
});
