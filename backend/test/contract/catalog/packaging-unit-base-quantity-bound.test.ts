import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351, architect ruling R3 (b) — a packaging unit's base quantity is a
 * line quantity: a unit larger than an orderable line is unorderable, and the
 * value lands in an integer column. Past `LINE_QUANTITY_MAX` the create and the
 * update are refused with `400 LINE_QUANTITY_EXCEEDED`.
 */
describe('packaging unit base quantity bound (issue #351)', () => {
  let h: BackendServerHandle;
  const ADMIN = { b2b_session: 'stub-admin-session' };
  const url = `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}/packaging-units`;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a create past the bound and creates one at it, whose update past the bound is refused', async () => {
    const create = (baseQuantity: number) =>
      h.app.inject({ method: 'POST', url, cookies: ADMIN, payload: { name: `Unit ${baseQuantity}-${Date.now()}`, baseQuantity } });
    expectQuantityRefused(await create(LINE_QUANTITY_MAX + 1), 'baseQuantity');
    expectQuantityRefused(await create(2 ** 31), 'baseQuantity');
    const created = await create(LINE_QUANTITY_MAX);
    expect(created.statusCode, created.body).toBe(201);
    const unitId = (created.json() as { data: { id: string } }).data.id;
    const update = await h.app.inject({
      method: 'PATCH',
      url: `${url}/${unitId}`,
      cookies: ADMIN,
      payload: { baseQuantity: LINE_QUANTITY_MAX + 1 },
    });
    expectQuantityRefused(update, 'baseQuantity');
  });
});
