import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReturnCase } from '../../helpers/package-entities.js';
import { collectTiedPages, expectTiesInIdOrder, placeholders, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the admin returns list pages by offset, so its submission-time
 * sort must be total: cases filed at the same instant need `id` as the
 * tie-breaker, or a page boundary repeats one case and skips another. An RMA
 * fragment isolates the seeded cases. (`rma_number` is unique, so its sort has
 * no ties to page through.)
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const SORTS = [
  { sort: 'submittedAt:desc', idDirection: 'desc' },
  { sort: 'submittedAt:asc', idDirection: 'asc' },
] as const;

describe('GET /api/v1/admin/returns — paging through equal sort keys (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `TIES${randomUUID().slice(0, 8)}`;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const salesChannelId = await systemDefaultSalesChannelId(em);
    const submittedAt = new Date('2001-02-03T04:05:06.000Z');
    const cases = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(ReturnCase, {
        kind: 'return',
        rmaNumber: `${marker}-${i}`,
        orderId: randomUUID(),
        salesChannelId,
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        statusCode: 'new',
        currency: 'PLN',
        submittedAt,
      } as never),
    );
    await em.persistAndFlush(cases);
    seededIds = cases.map((c) => (c as unknown as { id: string }).id);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h.em().getConnection().execute(`delete from return_cases where id in (${placeholders(seededIds)})`, seededIds);
    }
    await teardownBackendServer(h);
  });

  it.each(SORTS)('$sort sees every tied case exactly once, ordered by id $idDirection', async ({ sort, idDirection }) => {
    const collected = await collectTiedPages(1, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/returns?rmaNumber=${marker}&sort=${sort}&page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: { rows: Array<{ id: string }>; total: number } };
      expect(body.data.total).toBe(TIE_ROW_COUNT);
      return body.data.rows.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, idDirection);
  });
});
