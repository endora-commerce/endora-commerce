import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { StockLevel } from '../../helpers/package-entities.js';
import { AvailabilityNotification } from '../../helpers/package-entities.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Feature 075, Phase C — the `inventory` cut fails closed.
 *
 * Twenty-one import sites became port resolutions, and the specifier is not the
 * point of the exercise: it is that a read whose owner is absent now **refuses**
 * where it used to answer. `em.find(Product, …)` cheerfully returned rows from a
 * table deactivation leaves in place, so an operator who switched `catalog` off
 * still saw a stock roster built out of it, and a buyer still got a storefront
 * stock figure for a catalogue the platform had stopped serving.
 *
 * Three edges are probed rather than all of them, chosen for what they
 * distinguish:
 *
 *  - **the admin roster** (`catalog`) — the surface whose rows are half this
 *    module's and half `catalog`'s, so a partial answer reads as a real one;
 *  - **the storefront stock figure** (`catalog`) — the customer-facing read,
 *    where "in stock" for a product nobody can buy is the worst answer;
 *  - **the availability-notification queue** (`customer_accounts`) — the
 *    identity read that turns a subscription into an e-mail address.
 *
 * The platform axis is driven here: it is the one a deployment that does not
 * ship the owner reaches, and it holds whatever the owner's activation
 * declaration says. `withModuleOff` asserts the flip took before the body
 * observes anything (issue #141) and restores in its own `finally`.
 */

const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';
const adminCookie = { b2b_session: 'stub-admin-session' };

type Probe = { statusCode: number; json: () => unknown };

describe('inventory — the cut edges fail closed (feature 075, Phase C)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // The roster paginates over products that have a stock row, so without one
    // the port is never reached and the probe would pass vacuously.
    const level = await em.findOne(StockLevel, {
      productId: SEED_PRODUCT_101_ID,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    if (level) {
      level.onHand = 9;
    } else {
      em.create(StockLevel, {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        onHand: 9,
      });
    }

    // Likewise for the notification queue: the customer lookup only happens for
    // rows that carry a customer account.
    const customer = await em.findOneOrFail(CustomerAccount, { role: 'organization_admin' });
    em.create(AvailabilityNotification, {
      productId: SEED_PRODUCT_101_ID,
      customerAccountId: customer.id,
      // Feature 087 Group B / D-187 — `availability_notifications` carries its
      // organisation and
      // `availability_notifications_organization_attribution_chk` refuses an
      // owned row without one. This is the stamp
      // `AvailabilityNotificationService.subscribe` writes, done by hand
      // because the fixture writes the row directly.
      organizationId: customer.organizationId,
      email: customer.email,
      status: 'queued',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const roster = (): Promise<Probe> =>
    h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory/levels',
      cookies: adminCookie,
    }) as unknown as Promise<Probe>;

  const storefrontStock = (): Promise<Probe> =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/inventory/stock/${SEED_PRODUCT_101_ID}`,
    }) as unknown as Promise<Probe>;

  const notificationQueue = (): Promise<Probe> =>
    h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory/availability-notifications',
      cookies: adminCookie,
    }) as unknown as Promise<Probe>;

  it('refuses the admin stock roster while `catalog` is unavailable', async () => {
    // Positive control: without it, an always-broken route would read as a
    // successful absence.
    const before = await roster();
    expect(before.statusCode).toBe(200);
    expect((before.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    await withModuleOff('catalog', 'platform-unavailable', async () => {
      const res = await roster();
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    const restored = await roster();
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the storefront stock figure while `catalog` is unavailable', async () => {
    const before = await storefrontStock();
    expect(before.statusCode).toBe(200);

    await withModuleOff('catalog', 'platform-unavailable', async () => {
      const res = await storefrontStock();
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    const restored = await storefrontStock();
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the availability-notification queue while `customer_accounts` is unavailable', async () => {
    const before = await notificationQueue();
    expect(before.statusCode).toBe(200);
    expect((before.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    await withModuleOff('customer_accounts', 'platform-unavailable', async () => {
      const res = await notificationQueue();
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    const restored = await notificationQueue();
    expect(restored.statusCode).toBe(200);
  });
});
