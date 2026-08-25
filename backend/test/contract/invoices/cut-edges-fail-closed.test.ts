import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { ADMIN_COOKIE, seedInvoiceableOrder } from '../../integration/invoices/helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';

/**
 * Feature 080, T048 (D-169) — `invoices`' last reach into `orders`' table.
 *
 * The admin invoice list takes `filter[orderNumber]`, and answered it with
 * `em.find(Order, { businessId: { $ilike } }, { fields: ['id'], limit: 500 })`
 * written inside `invoices`. That is a plain read of another module's table, so
 * it takes a **read-port method** — `OrderReadPort.findIdsByBusinessIdLike`,
 * which `orders` has published since feature 075's Phase P and which no
 * consumer had ever resolved.
 *
 * The **no-match** case is the one that makes this worth a test of its own. The
 * route short-circuits on an empty match set and returns `{ data: [] }` without
 * touching any other port, so before the cut a request naming an order number
 * nobody has got a cheerful 200 out of a module the platform was not serving:
 * "no invoice for that order number" is a statement about the shop's records,
 * and it was being made by a table read rather than by `orders`. A `filter`
 * whose owner is absent has to refuse.
 *
 * `orders` declares `nonDeactivatable`, so there is no operator axis to drive:
 * the platform axis below is the one a deployment that does not ship the module
 * reaches, and it is the axis this cut is measured on. Positive controls both
 * sides — an always-broken route reads as a successful absence without them.
 */
describe('invoices — the order-number filter fails closed (feature 080, T048)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let orderNumber: string;

  type Reply = { statusCode: number; json: () => unknown };

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await ensureSalesChannelId(h.em(), 'inv-t048');
    const seeded = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId });
    orderNumber = (await h.em().findOneOrFail(Order, { id: seeded.orderId })).businessId;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const list = (filter: string): Promise<Reply> =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices?filter[orderNumber]=${encodeURIComponent(filter)}`,
      cookies: ADMIN_COOKIE,
    }) as unknown as Promise<Reply>;

  const errorCode = (res: Reply): string | undefined =>
    (res.json() as { error?: { code?: string } }).error?.code;

  it('refuses the order-number filter while `orders` is unavailable', async () => {
    const before = await list(orderNumber);
    expect(before.statusCode).toBe(200);

    await withModuleOff('orders', 'platform-unavailable', async () => {
      const res = await list(orderNumber);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await list(orderNumber);
    expect(restored.statusCode).toBe(200);
  });

  it('refuses a no-match order-number filter too, rather than answering “none”', async () => {
    const before = await list('zzz-no-such-order-zzz');
    expect(before.statusCode).toBe(200);
    expect((before.json() as { data: unknown[] }).data).toEqual([]);

    await withModuleOff('orders', 'platform-unavailable', async () => {
      const res = await list('zzz-no-such-order-zzz');
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });
  });
});
