import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedCartOrganization, type CartFixtureOrganization } from '../../helpers/cart-approval-roles.js';
import { Cart } from '../../helpers/package-entities.js';
import { collectTiedPages, expectTiesInIdOrder, placeholders, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the organization carts list (`GET /api/v1/organization/carts`)
 * pages by offset, so every sort it offers must be total, as #1621 made the
 * admin list's. The carts sit in a fresh Organization and share all three
 * timestamps, so only `id` can order them.
 */

const TIE_INSTANT = '2001-02-03T04:05:06.000Z';
const SORTS = [
  { sort: 'last_activity_desc', idDirection: 'desc' },
  { sort: 'last_activity_asc', idDirection: 'asc' },
  { sort: 'total_desc', idDirection: 'desc' },
  { sort: 'total_asc', idDirection: 'asc' },
  { sort: 'created_desc', idDirection: 'desc' },
] as const;

describe('GET /api/v1/organization/carts — paging through equal sort keys (issue #1760)', () => {
  let h: BackendServerHandle;
  let org: CartFixtureOrganization;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedCartOrganization(h, { label: 'Issue 1760 cart ties', members: { ADMIN: 'administrator' } });
    const em = h.em();
    const salesChannelId = await systemDefaultSalesChannelId(em);
    const carts = Array.from({ length: TIE_ROW_COUNT }, () =>
      em.create(Cart, {
        organizationId: org.organizationId,
        customerAccountId: org.actors['ADMIN']!.id,
        salesChannelId,
        // Not `active`: one active cart per customer and channel.
        status: 'abandoned',
      }),
    );
    await em.persist(carts).flush();
    seededIds = carts.map((c) => c.id);
    // Raw SQL so the entity's `onUpdate` hook cannot move `updated_at`.
    await em
      .getConnection()
      .execute(
        `update carts set last_activity_at = ?, created_at = ?, updated_at = ? where id in (${placeholders(seededIds)})`,
        [TIE_INSTANT, TIE_INSTANT, TIE_INSTANT, ...seededIds],
      );
  }, 60_000);

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h.em().getConnection().execute(`delete from carts where id in (${placeholders(seededIds)})`, seededIds);
    }
    org?.release();
    await teardownBackendServer(h);
  });

  it.each(SORTS)('$sort sees every tied cart exactly once, ordered by id $idDirection', async ({ sort, idDirection }) => {
    const collected = await collectTiedPages(1, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/organization/carts?sort=${sort}&page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: { b2b_session: org.actors['ADMIN']!.cookie },
        headers: { 'x-sales-channel': 'pl_retail' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ id: string }>; meta: { totalCount: number } };
      expect(body.meta.totalCount).toBe(TIE_ROW_COUNT);
      return body.data.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, idDirection);
  });
});
