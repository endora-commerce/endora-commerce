import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (Principle XVII) — `price_lists` is non-deactivatable by an
 * operator, but a platform that does not compose it must behave as if it had
 * never been installed. With it absent, the catalogue-event subscriptions that
 * mark the price surface stale do not run (`ctx.subscribe`), and the pricing
 * port refuses rather than ordering or pricing anything. The surface worker is
 * attached with `ctx.worker` and stops with the module the same way (the shared
 * harness runs no queue workers, so that half is the composition's guarantee).
 */
const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

describe('price_lists — absent, the surface subscriptions and the ports stop', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  async function buildSurface(): Promise<void> {
    await f.pricing.orderByUnitPrice({
      context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
      direction: 'asc',
      after: null,
      limit: 1,
    });
    expect(await sql<{ state: string }>(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'ready' }]);
  }

  const emitProductUpdated = async () => {
    h.eventBus.emit('product.updated.v1' as never, {
      eventId: `test-${Date.now()}`,
      occurredAt: new Date().toISOString(),
      productId: f.products.P1.id,
      changedFields: ['categoryIds'],
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  it('on: a catalogue event marks the surface stale', async () => {
    await buildSurface();
    await emitProductUpdated();
    expect(await sql<{ state: string }>(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'building' }]);
  });

  it('absent: the same event marks nothing, and the pricing port refuses', async () => {
    await buildSurface();
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));
    await emitProductUpdated();
    expect(await sql<{ state: string }>(`select distinct "state" from "price_profiles"`)).toEqual([{ state: 'ready' }]);
    const order = async () =>
      (h.container as unknown as { resolve<T>(n: string): T })
        .resolve<{ orderByUnitPrice: typeof f.pricing.orderByUnitPrice }>('pricingService')
        .orderByUnitPrice({
          context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
          direction: 'asc',
          after: null,
          limit: 1,
        });
    // The port refuses at resolution or at the call — either way the caller sees MODULE_DISABLED.
    await expect(order()
    ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });
});
