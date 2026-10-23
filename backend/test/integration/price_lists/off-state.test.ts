import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';

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
    await settlePriceSurface(h);
    expect(await marked()).toEqual({ stale: 0, products: 0 });
  }

  /** What is marked on the surface: whole profiles, and (profile, product) marks (`contracts/price-surface.md` §4). */
  const marked = async () => {
    const [row] = await sql<{ stale: number; products: number }>(
      `select (select count(*)::int from "price_profiles" where "stale") as "stale",
              (select count(*)::int from "price_profile_stale_products") as "products"`,
    );
    return row!;
  };

  const emitProductUpdated = async () => {
    h.eventBus.emit('product.updated.v1' as never, {
      eventId: `test-${Date.now()}`,
      occurredAt: new Date().toISOString(),
      productId: f.products.P1.id,
      changedFields: ['categoryIds'],
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  it('on: a catalogue event marks the product on the surface', async () => {
    await buildSurface();
    await emitProductUpdated();
    expect((await marked()).products).toBeGreaterThan(0);
    await settlePriceSurface(h);
  });

  it('absent: the same event marks nothing, and the pricing port refuses', async () => {
    await buildSurface();
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));
    await emitProductUpdated();
    expect(await marked()).toEqual({ stale: 0, products: 0 });
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

  /**
   * Feature 161 (T100; FR-029) — the editor's endpoints, the G11–G19 gaps
   * among them, and its four palette actions. Each is seen answering while the
   * module is present before its absence is asserted, so an absence proves
   * something; absent, every route answers `503 MODULE_DISABLED` naming
   * `price_lists`, and the palette advertises none of its actions.
   */
  describe('the price-book editor (161)', () => {
    const admin = { b2b_session: 'stub-admin-session' };
    const B = '/api/v1/admin/price-books';
    let bookId: string;

    beforeAll(async () => {
      bookId = (await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, percent: '-5' }] })).id;
    });

    const routes = (): Array<{ method: 'GET' | 'PUT'; url: string; payload?: Record<string, unknown> }> => [
      { method: 'GET', url: `${B}?page=1&pageSize=5` },
      { method: 'GET', url: `${B}/${bookId}` },
      { method: 'GET', url: `${B}/${bookId}/lines?page=1&pageSize=10` },
      { method: 'GET', url: `${B}/${bookId}/product-lines?productIds=${f.products.P1.id}` },
      { method: 'GET', url: `${B}/${bookId}/rows?page=1&pageSize=10` },
      { method: 'PUT', url: `${B}/${bookId}/rows?dryRun=true`, payload: { mode: 'merge', upsert: [], delete: [] } },
      { method: 'GET', url: `${B}/precedence` },
      { method: 'GET', url: `${B}/settings/show-list-price` },
      { method: 'GET', url: `${B}/base-prices?productId=${f.products.P1.id}` },
      { method: 'GET', url: `${B}/targets/currencies` },
    ];

    const call = (route: ReturnType<typeof routes>[number]) =>
      h.app.inject({ method: route.method, url: route.url, cookies: admin, ...(route.payload ? { payload: route.payload } : {}) });

    const advertised = async (): Promise<string[]> => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/admin-actions?language=en', cookies: admin });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: { data: Array<{ actionId: string; moduleId: string }> } };
      return body.data.data.filter((a) => a.moduleId === 'price_lists').map((a) => a.actionId).sort();
    };

    it('present: every editor endpoint answers, and the four palette actions are advertised', async () => {
      for (const route of routes()) {
        const res = await call(route);
        expect(res.statusCode, `${route.method} ${route.url}: ${res.body}`).toBe(200);
      }
      expect(await advertised()).toEqual(['new-price-book', 'open-price-explainer', 'open-price-lists', 'open-pricing-settings']);
    });

    it('absent: every editor endpoint answers MODULE_DISABLED, the palette advertises none, and both come back', async () => {
      registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));
      for (const route of routes()) {
        const res = await call(route);
        expect(res.statusCode, `${route.method} ${route.url}`).toBe(503);
        const body = res.json() as { error?: { code?: string; details?: { module?: string } } };
        expect(body.error?.code).toBe('MODULE_DISABLED');
        expect(body.error?.details?.module).toBe('price_lists');
      }
      expect(await advertised()).toEqual([]);
      registryCache.__setEnabledForTesting(ALL_IDS);
      expect((await call(routes()[0]!)).statusCode).toBe(200);
      expect(await advertised()).toHaveLength(4);
    });
  });
});
