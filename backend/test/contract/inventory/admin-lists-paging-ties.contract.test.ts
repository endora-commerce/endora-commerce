import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AvailabilityNotification, Warehouse } from '../../helpers/package-entities.js';
import {
  collectTiedPages,
  expectTiesInIdOrder,
  placeholders,
  TIE_PAST,
  TIE_PAGE_SIZE,
  TIE_ROW_COUNT,
} from '../../helpers/paging-ties.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — the inventory admin lists page by offset, so rows sharing the
 * sort key need `id` as the tie-breaker, or a page boundary repeats one row and
 * skips another. Warehouses are listed oldest first, so the seeded ones share a
 * creation time no other row holds, far in the past; availability requests are
 * listed newest first and a product id isolates them.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('admin inventory lists — paging through equal sort keys (issue #1760)', () => {
  let h: BackendServerHandle;
  const marker = `ties-${randomUUID().slice(0, 8)}`;
  const productId = randomUUID();
  let warehouseIds: string[] = [];
  let notificationIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const warehouses = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(Warehouse, { name: `Paging ties ${i}`, code: `${marker}-${i}`, active: false }),
    );
    const notifications = Array.from({ length: TIE_ROW_COUNT }, (_, i) =>
      em.create(AvailabilityNotification, { productId, email: `${marker}-${i}@example.com` }),
    );
    await em.persist([...warehouses, ...notifications]).flush();
    warehouseIds = warehouses.map((w) => w.id);
    notificationIds = notifications.map((n) => n.id);
    const connection = em.getConnection();
    await connection.execute(`update warehouses set created_at = ? where id in (${placeholders(warehouseIds)})`, [
      TIE_PAST,
      ...warehouseIds,
    ]);
    await connection.execute(
      `update availability_notifications set requested_at = ? where id in (${placeholders(notificationIds)})`,
      ['2001-02-03T04:05:06.000Z', ...notificationIds],
    );
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    if (warehouseIds.length > 0) {
      await connection.execute(`delete from warehouses where id in (${placeholders(warehouseIds)})`, warehouseIds);
    }
    await connection.execute('delete from availability_notifications where product_id = ?', [productId]);
    await teardownBackendServer(h);
  });

  async function page(url: string): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url, cookies: ADMIN_COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { items: Array<{ id: string }> }).items.map((r) => r.id);
  }

  it('GET /api/v1/admin/warehouses sees every tied warehouse once, ordered by id asc', async () => {
    const collected = await collectTiedPages(0, (p) =>
      page(`/api/v1/admin/warehouses?page=${p}&pageSize=${TIE_PAGE_SIZE}&withTotals=false`),
    );
    expectTiesInIdOrder(collected, warehouseIds, 'asc');
  });

  it('GET /api/v1/admin/inventory/availability-notifications sees every tied request once, ordered by id desc', async () => {
    const collected = await collectTiedPages(0, (p) =>
      page(
        `/api/v1/admin/inventory/availability-notifications?productId=${productId}&page=${p}&pageSize=${TIE_PAGE_SIZE}`,
      ),
    );
    expectTiesInIdOrder(collected, notificationIds, 'desc');
  });
});
