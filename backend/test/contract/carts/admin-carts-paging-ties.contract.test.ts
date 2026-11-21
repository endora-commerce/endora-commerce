import { Cart } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #1621 — the admin carts list pages by offset, so every sort it offers
 * must be total. Carts sharing a sort key (same last activity, same creation
 * time, same update time) need `id` as the tie-breaker, or a page boundary can
 * repeat one cart and skip another.
 *
 * The seeded carts share all three timestamps and sit alone in a last-activity
 * window far in the past, so the filter isolates them from every other row.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const TIE_INSTANT = '2001-02-03T04:05:06.000Z';
const CART_COUNT = 7;
const PAGE_SIZE = 2;

const SORTS = [
  { sort: 'last_activity_desc', idDirection: 'desc' },
  { sort: 'last_activity_asc', idDirection: 'asc' },
  { sort: 'total_desc', idDirection: 'desc' },
  { sort: 'total_asc', idDirection: 'asc' },
  { sort: 'created_desc', idDirection: 'desc' },
] as const;

describe('GET /api/v1/admin/carts — paging through equal sort keys (issue #1621)', () => {
  let h: BackendServerHandle;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const ch = await em.findOne(SalesChannel, { systemDefault: true });
    const carts = Array.from({ length: CART_COUNT }, (_, i) =>
      em.create(Cart, {
        anonymousCartToken: `anon-admin-ties-${Date.now()}-${i}`,
        salesChannelId: ch?.id ?? null,
      }),
    );
    await em.persistAndFlush(carts);
    seededIds = carts.map((c) => c.id);
    // Raw SQL so the entity's `onUpdate` hook cannot move `updated_at`.
    await em
      .getConnection()
      .execute(
        `update carts set last_activity_at = ?, created_at = ?, updated_at = ? where id in (${seededIds
          .map(() => '?')
          .join(', ')})`,
        [TIE_INSTANT, TIE_INSTANT, TIE_INSTANT, ...seededIds],
      );
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from carts where id in (${seededIds.map(() => '?').join(', ')})`, seededIds);
    }
    await teardownBackendServer(h);
  });

  it.each(SORTS)('$sort sees every tied cart exactly once, ordered by id $idDirection', async ({ sort, idDirection }) => {
    const pages = Math.ceil(CART_COUNT / PAGE_SIZE);
    const collected: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const res = await h.app.inject({
        method: 'GET',
        url:
          `/api/v1/admin/carts?sort=${sort}&page=${page}&pageSize=${PAGE_SIZE}` +
          `&lastActivityFrom=${encodeURIComponent(TIE_INSTANT)}&lastActivityTo=${encodeURIComponent(TIE_INSTANT)}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ id: string }>; meta: { totalCount: number } };
      expect(body.meta.totalCount).toBe(CART_COUNT);
      collected.push(...body.data.map((r) => r.id));
    }

    expect(new Set(collected).size).toBe(collected.length);
    expect([...collected].sort()).toEqual([...seededIds].sort());

    const expected = [...seededIds].sort();
    if (idDirection === 'desc') expected.reverse();
    expect(collected).toEqual(expected);
  });
});
