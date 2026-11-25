import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CustomerAccount } from '../../helpers/package-entities.js';
import { collectTiedPages, expectTiesInIdOrder, placeholders, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the admin customers list pages by offset, newest first, so
 * accounts created in the same instant need `id` as the tie-breaker, or a page
 * boundary repeats one account and skips another. An e-mail fragment isolates
 * the seeded accounts; with no field selection the list keeps its default
 * order, which is the one this holds.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/customers — paging through equal creation times (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `ties-${randomUUID().slice(0, 8)}`;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const accounts = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(CustomerAccount, {
        organizationId: TEST_ORGANIZATION_ID,
        email: `${marker}-${i}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Paging',
        lastName: `Ties ${i}`,
      } as never),
    );
    await em.persist(accounts).flush();
    seededIds = accounts.map((a) => (a as unknown as { id: string }).id);
    await em
      .getConnection()
      .execute(`update customer_accounts set created_at = ? where id in (${placeholders(seededIds)})`, [
        '2001-02-03T04:05:06.000Z',
        ...seededIds,
      ]);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h
        .em()
        .getConnection()
        .execute(`delete from customer_accounts where id in (${placeholders(seededIds)})`, seededIds);
    }
    await teardownBackendServer(h);
  });

  it('sees every tied account exactly once, ordered by id desc', async () => {
    const collected = await collectTiedPages(1, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers?q=${marker}&page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ id: string }>; meta: { total: number } };
      expect(body.meta.total).toBe(TIE_ROW_COUNT);
      return body.data.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, 'desc');
  });
});
