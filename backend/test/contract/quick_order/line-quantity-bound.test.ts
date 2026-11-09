import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — quick order bounds a line's quantity at `LINE_QUANTITY_MAX`: the
 * buyer's and the operator's build and the one-click request answer one past it
 * with `400 VALIDATION_FAILED` naming the field and accept the bound, and an
 * imported row past it is rejected as `quantity_invalid` rather than recognised
 * into a build that would be refused. The line-count bound on the build is
 * `build.test.ts` / `admin-build.test.ts`.
 */
describe('quick order — line quantity bound (issue #351)', () => {
  let h: BackendServerHandle;
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const build = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/build',
      cookies: CUSTOMER,
      payload: { target: 'quote_request', items: [{ productId: SEED_PRODUCT_101_ID, quantity }] },
    });

  const adminBuild = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/build',
      cookies: ADMIN,
      payload: {
        target: 'quote_request',
        items: [{ productId: SEED_PRODUCT_101_ID, quantity }],
        onBehalfOf: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      },
    });

  const oneClick = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: CUSTOMER,
      payload: { productId: SEED_PRODUCT_101_ID, quantity },
    });

  it('POST /api/v1/quick-order/build refuses one past the bound and builds the bound', async () => {
    expectQuantityRefused(await build(LINE_QUANTITY_MAX + 1), 'items.0.quantity');
    const res = await build(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
  });

  it('POST /api/v1/admin/quick-order/build refuses one past the bound and builds the bound', async () => {
    expectQuantityRefused(await adminBuild(LINE_QUANTITY_MAX + 1), 'items.0.quantity');
    const res = await adminBuild(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
  });

  it('POST /api/v1/quick-order/one-click refuses one past the bound; the bound passes validation', async () => {
    expectQuantityRefused(await oneClick(LINE_QUANTITY_MAX + 1), 'quantity');
    // One-click is switched off for the stub customer, so the bound is refused
    // by eligibility — not by validation, which is what this asserts.
    const res = await oneClick(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).not.toBe(400);
  });

  it('POST /api/v1/quick-order/import rejects a row past the bound as quantity_invalid and recognises the bound', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: CUSTOMER,
      payload: { csv: `sku,quantity\n${SEED_PRODUCT_101_SKU},${LINE_QUANTITY_MAX + 1}\n${SEED_PRODUCT_101_SKU},${LINE_QUANTITY_MAX}` },
    });
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
    const data = (res.json() as {
      data: { recognized: Array<{ line: number; quantity: number }>; rejected: Array<{ line: number; reason: string }> };
    }).data;
    expect(data.rejected).toEqual([expect.objectContaining({ line: 2, reason: 'quantity_invalid' })]);
    expect(data.recognized.map((r) => r.quantity)).toEqual([LINE_QUANTITY_MAX]);
  });

  it('POST /api/v1/quick-order/import rejects duplicate rows whose sum passes the bound (R3)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: CUSTOMER,
      payload: { csv: `sku,quantity\n${SEED_PRODUCT_101_SKU},${LINE_QUANTITY_MAX}\n${SEED_PRODUCT_101_SKU},1` },
    });
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
    const data = (res.json() as {
      data: { recognized: unknown[]; rejected: Array<{ line: number; reason: string }> };
    }).data;
    expect(data.recognized).toEqual([]);
    expect(data.rejected.map((r) => [r.line, r.reason])).toEqual([
      [2, 'quantity_invalid'],
      [3, 'quantity_invalid'],
    ]);
  });
});
