import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Order } from '../../helpers/package-entities.js';
import { collectTiedPages, expectTiesInIdOrder, placeholders, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the admin orders list pages by offset, so every sort it offers
 * must be total. Orders sharing the sort key need `id` as the tie-breaker, or a
 * page boundary repeats one order and skips another. The seeded orders share
 * placement time, total and status, and a business-id fragment isolates them.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const SORTS = [
  { sort: 'placedAt:desc', idDirection: 'desc' },
  { sort: 'placedAt:asc', idDirection: 'asc' },
  { sort: 'total:desc', idDirection: 'desc' },
  { sort: 'status:asc', idDirection: 'asc' },
] as const;

describe('GET /api/v1/admin/orders — paging through equal sort keys (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `QA-TIES-${randomUUID().slice(0, 8)}`;
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const salesChannelId = await systemDefaultSalesChannelId(em);
    const placedAt = new Date('2001-02-03T04:05:06.000Z');
    const address = { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' };
    const orders = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(Order, {
        businessId: `${marker}-${i}`,
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId,
        status: 'new',
        deliveryAddress: address,
        billingAddress: address,
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '100.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '100.00',
        currency: 'PLN',
        placedAt,
      }),
    );
    await em.persist(orders).flush();
    seededIds = orders.map((o) => o.id);
  });

  afterAll(async () => {
    if (seededIds.length > 0) {
      await h.em().getConnection().execute(`delete from orders where id in (${placeholders(seededIds)})`, seededIds);
    }
    await teardownBackendServer(h);
  });

  it.each(SORTS)('$sort sees every tied order exactly once, ordered by id $idDirection', async ({ sort, idDirection }) => {
    const collected = await collectTiedPages(1, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/orders?q=${marker}&sort=${sort}&page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ id: string }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(TIE_ROW_COUNT);
      return body.data.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, idDirection);
  });
});
