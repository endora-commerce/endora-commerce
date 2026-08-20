import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The `degrades-without` edges whose owner an operator can genuinely switch
 * off, each seen with the owner off — D-44 §10, and the risk it names in as
 * many words:
 *
 * > a `degrades-without` edge whose degradation is not actually implemented …
 * > the operator gets a crash where the old refusal gave a 409 — a strictly
 * > worse trade.
 *
 * That trade is what these four assertions exist to refuse. Every one of these
 * edges used to be held shut by a suppression in `check-port-dependencies.ts`,
 * on the argument that declaring it would make the owner unswitchable. The
 * declaration now withdraws the refusal instead — so the state below is one an
 * operator can genuinely reach, and each edge has to answer for it **by name**:
 * one test per manifest entry, asserting the sentence its `whenAbsent` field
 * promises rather than merely that nothing exploded.
 *
 * Two things are asserted at every edge, because either alone passes for the
 * wrong reason:
 *
 *  1. the declared degradation happens — an empty page, a 401 — and **not** a
 *     503 `MODULE_DISABLED`, which is what a resolution without a presence probe
 *     produces;
 *  2. the dependent keeps working elsewhere. A module that answers 401 to
 *     everything degrades too, and would pass (1).
 *
 * The operator axis only: `platformAvailable` stays true throughout, which is
 * the case Constitution XVII's checklist item 6 singles out.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

describe('nonBindingDependencies — the declared degradation, with the owner off [integration]', () => {
  let h: BackendServerHandle;
  let unboundToken: string;
  let boundToken: string;

  const mint = async (payload: Record<string, unknown>): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  };

  const deactivate = (moduleId: string): void => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: [moduleId] });
  };

  /**
   * Absence on the **platform** axis, for an owner feature 074 made core.
   *
   * `orders` is now `nonDeactivatable`, and `operatorActivated` short-circuits
   * to `true` for such a module however the activation map is seeded — so
   * `deactivate('orders')` stopped making it absent, and the three cases under
   * it went on passing while asserting nothing (an empty order history is also
   * what a customer with no orders sees). The declared degradation is still
   * reachable, by the axis a deployment operator drives: a deployment that does
   * not install `orders` at all. Withdrawing the module from the enabled set is
   * that state, and it is the honest way to keep the edge covered.
   */
  const withdraw = (moduleId: string): void => {
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== moduleId));
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    unboundToken = await mint({
      name: 'non-binding unbound',
      scopes: ['catalog:read', 'catalog:write'],
    });
    boundToken = await mint({
      name: 'non-binding bound',
      scopes: ['catalog:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: (await h.salesChannels.resolver.getSystemDefault()).id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
  }, 60_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  /**
   * `auth` → `api_keys:apiKeyResolver`, whenAbsent: *requests presenting an API
   * key are not authenticated*.
   *
   * The sharpest of the four, because the read sits in the request hook of the
   * one module every request passes through. `apiKeyResolver` is a gated port,
   * so without the presence probe a switched-off `api_keys` would turn **every**
   * request carrying an `Authorization: Bearer` header into a 503 — on any
   * route, public ones included, whether or not the endpoint has anything to do
   * with API keys. The `?.` that was already there defends against "nobody
   * registered the name" and not against a gate that says no.
   */
  describe('auth → api_keys:apiKeyResolver', () => {
    it('leaves a Bearer-carrying request unauthenticated rather than failing it', async () => {
      deactivate('api_keys');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/storefront/module-presence',
        headers: { authorization: `Bearer ${unboundToken}` },
      });

      // A public route, and the header is now simply not an identity. 503 here
      // would mean the request hook asked a closed gate.
      expect(res.statusCode).toBe(200);
      const body = res.json() as { modules: Array<{ id: string; present: boolean }> };
      expect(body.modules.find((m) => m.id === 'api_keys')?.present).toBe(false);
    });

    it('authenticates the same token again once the module is switched back on', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/catalog/attribute-sets',
        headers: { authorization: `Bearer ${unboundToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  /**
   * `catalog` → `api_keys:requireApiKey`, whenAbsent: *the external catalog
   * namespace stops accepting machine-to-machine callers*.
   */
  describe('catalog → api_keys:requireApiKey', () => {
    it('shuts the machine-to-machine door with a 401, not a 503', async () => {
      deactivate('api_keys');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/catalog/attribute-sets',
        headers: { authorization: `Bearer ${unboundToken}` },
      });

      // The door is shut, not broken: the same answer an unauthenticated caller
      // gets. A 503 would say `catalog` is off, which it is not.
      expect(res.statusCode).toBe(401);
    });

    it('leaves the rest of `catalog` serving while the door is shut', async () => {
      deactivate('api_keys');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/catalog/products',
        cookies: ADMIN,
      });

      // The degradation is one namespace, not the module. Without this the test
      // above would pass for a `catalog` that had stopped answering entirely.
      expect(res.statusCode).toBe(200);
    });

    it('accepts the key again once the module is switched back on', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/catalog/attribute-sets',
        headers: { authorization: `Bearer ${unboundToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  /**
   * `catalog` → `api_keys:requireBoundApiKey`, same sentence: the
   * organization-bound half of the gate above, guarding
   * `/api/v1/external/catalog/*`.
   */
  describe('catalog → api_keys:requireBoundApiKey', () => {
    it('shuts the external namespace with a 401, not a 503', async () => {
      deactivate('api_keys');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/external/catalog/products',
        headers: { authorization: `Bearer ${boundToken}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('serves the bound key again once the module is switched back on', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/external/catalog/products',
        headers: { authorization: `Bearer ${boundToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  /**
   * `catalog` → `search:searchQueryPort`, whenAbsent: *the storefront product
   * listing is served from PostgreSQL instead of the search index* (issue #153).
   *
   * The one edge here whose dependent is a **public** surface, which is what
   * decides the shape of the degrade: `catalog` is non-deactivatable, Postgres
   * is the listing's default backend, and refusing a storefront product list
   * because an optional search module is off would take the shop down for a
   * capability it never required.
   *
   * It is also the edge that had no declaration to test until #153, and the
   * reason is worth stating where the test is: `catalog` constructed its own
   * `SearchQueryService` out of `search`'s class, so the container held no edge
   * between the two, `findNonBindingIssues` would have rejected the declaration
   * as `nothing-resolves`, and the fallback below — which was already correct —
   * was a behaviour no operator could be told about.
   *
   * The env toggle is what makes the flip load-bearing: with
   * `CATALOG_SEARCH_BACKEND` unset the listing reads Postgres whatever
   * `search`'s state is, so the assertion would hold for a route that never
   * asked. The second case is the other half — the gate really does refuse,
   * so what keeps the listing serving is the presence probe in front of it and
   * not the absence of one.
   */
  describe('catalog → search:searchQueryPort', () => {
    let originalBackend: string | undefined;

    beforeAll(() => {
      originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
      process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    });

    afterAll(() => {
      if (originalBackend === undefined) delete process.env['CATALOG_SEARCH_BACKEND'];
      else process.env['CATALOG_SEARCH_BACKEND'] = originalBackend;
    });

    it('serves the public product listing from Postgres rather than refusing it', async () => {
      // A precondition, not the assertion: the suite shares one fork and one
      // database, and a previous file's reseed can leave the channel cache
      // pointing `pl_retail` at an id that no longer exists — the request then
      // resolves to the empty default channel and answers an empty page for a
      // reason that has nothing to do with `search`. Dropping the cache is the
      // sanctioned seam for that (issue #154's family, and see the stale-id
      // note in `test-server.ts`).
      await h.salesChannels.cache.invalidateAll();
      deactivate('search');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/catalog/products?limit=50',
        headers: { 'x-sales-channel': 'pl_retail' },
      });

      expect(res.statusCode, 'a public catalogue must degrade, not 503').toBe(200);
      expect(res.headers['x-search-backend']).toBe('postgres');
      // Products, not an empty page: "nothing exploded" is also what a broken
      // listing returns, and the sentence promises a served catalogue.
      const body = res.json() as { data: Array<{ sku: string }> };
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('would have been refused at the gate — the probe is what avoided it', async () => {
      deactivate('search');

      // Meilisearch is never contacted in this file; what is asserted is that
      // the port the listing holds is a real gate with a real "no", so the 200
      // above is a decision rather than an accident of an unreachable index.
      expect(() => h.container.cradle['searchQueryPort']).toThrow(ModuleDisabledError);
    });

    it('leaves `search`’s own surface refusing while it is off', async () => {
      deactivate('search');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/search/suggest?q=widget',
      });

      // The mirror of the "leaves the rest of `catalog` serving" guards above:
      // the degrade must be the listing changing backend, not `search` having
      // gone on running.
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
    });

    it('hands the query back to `search` once the module is switched on again', async () => {
      // The port resolves again, and the listing still answers. The header is
      // deliberately not asserted here: with `search` present and no
      // Meilisearch running, the port reports `index-unavailable` and the route
      // degrades to Postgres for an entirely different reason — asserting
      // `meilisearch` would make this case pass or fail on whether docker is up.
      expect(() => h.container.cradle['searchQueryPort']).not.toThrow();

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/catalog/products?limit=50',
      });
      expect(res.statusCode).toBe(200);
    });
  });

  /**
   * `customers` → `orders:orderListServiceAccessor`, whenAbsent: *order history
   * is empty on the self-service and admin customer panels*.
   *
   * The accessor's `() => OrderListService | null` return type looks like it
   * already tolerates an absent `orders`, and that is the trap: it is a gated
   * port, so an absent `orders` makes the resolution throw before the `null`
   * check is ever reached. The declared behaviour is an empty page — the same
   * page a customer with no orders sees.
   *
   * **The platform axis, not the operator axis** (feature 074). `orders` is
   * core now: the transaction the platform exists to record is not a capability
   * a business declines, so no operator can produce this state. A deployment
   * that never installs the module still can, the container claim is unchanged,
   * and the spec keeps the declaration legal for exactly that reason. Left on
   * `deactivate` these three cases would pass without the module ever being
   * absent, which is worse than deleting them.
   */
  describe('customers → orders:orderListServiceAccessor', () => {
    it('answers an empty self-service order history rather than failing', async () => {
      withdraw('orders');

      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer/orders',
        cookies: CUSTOMER,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[]; meta: { total: number } };
      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
    });

    it('answers an empty admin order-history panel rather than failing', async () => {
      withdraw('orders');

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/orders`,
        cookies: ADMIN,
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('leaves the rest of the customer surface serving', async () => {
      withdraw('orders');

      // Same guard as on the `catalog` edge: an empty history proves nothing if
      // the whole module has stopped answering.
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer',
        cookies: CUSTOMER,
      });
      expect(res.statusCode).toBe(200);
    });

    it('lists orders again once the module is available again', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer/orders',
        cookies: CUSTOMER,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  /**
   * `orders` → `payment_methods:paymentAdapterRegistry` and
   * `payment_methods:paymentOrderStatusRegistry`, whenAbsent: *checkout offers
   * no payment method to choose from*; and
   * `orders` → `delivery_methods:shippingAdapterRegistry`, whenAbsent:
   * *checkout offers no delivery method to choose from* (feature 074, FR-024).
   *
   * These three read a **plain registration** rather than a gated port, so the
   * failure they used to have was not a crash: `orders` froze all three into
   * `commerceModule`'s options at construction and went on holding them after
   * the owner was switched off. The accessor change is what makes the sentence
   * above true, and the sentence is about the *choice* rather than about order
   * taking: the module that serves the catalogue closes its own seam, while
   * every order already placed stays readable and manageable.
   */
  describe('orders → the two method modules', () => {
    it('closes the payment-method catalogue and leaves order taking serving', async () => {
      deactivate('payment_methods');

      const methods = await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods' });
      expect(methods.statusCode).toBe(503);
      expect((methods.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');

      // The degradation is the choice, not the module that reads it. Without
      // this half the assertion above would pass for an `orders` that had
      // stopped answering with it.
      const orders = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        cookies: ADMIN,
      });
      expect(orders.statusCode).toBe(200);
    });

    it('closes the delivery-method catalogue and leaves order taking serving', async () => {
      deactivate('delivery_methods');

      const methods = await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods' });
      expect(methods.statusCode).toBe(503);

      const orders = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/orders',
        cookies: ADMIN,
      });
      expect(orders.statusCode).toBe(200);
    });

    it('offers both catalogues again once the modules are switched back on', async () => {
      for (const url of ['/api/v1/payment-methods', '/api/v1/delivery-methods']) {
        const res = await h.app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
      }
    });
  });

  it('exercises the deactivated-while-platform-available case throughout', () => {
    // Constitution XVII checklist item 6 asks for this case specifically, and
    // it is the one the edges above are written for: a module the deployment
    // still ships, that the business has switched off. A test that simulated a
    // missing installation would prove something else.
    for (const moduleId of ['api_keys', 'payment_methods', 'delivery_methods']) {
      deactivate(moduleId);
      const presence = effectiveState.presence(moduleId);
      expect(presence?.platformAvailable, `${moduleId} platform axis`).toBe(true);
      expect(presence?.operatorActivated, `${moduleId} operator axis`).toBe(false);
      expect(effectiveState.isPresent(moduleId), `${moduleId} effective presence`).toBe(false);
    }
  });

  it('reaches the `orders` edge by the one axis that can still produce it', () => {
    // The fourth edge, stated separately rather than dropped from the list
    // above. Feature 074 makes `orders` core, so the operator axis is closed to
    // it by declaration — asserted here, so that a future change which reopens
    // the operator route is visible — and the platform axis is what the three
    // cases above drive.
    deactivate('orders');
    expect(
      effectiveState.presence('orders')?.operatorActivated,
      'orders is core; no seeded activation value may make it absent',
    ).toBe(true);

    withdraw('orders');
    const presence = effectiveState.presence('orders');
    expect(presence?.platformAvailable, 'orders platform axis').toBe(false);
    expect(effectiveState.isPresent('orders'), 'orders effective presence').toBe(false);
  });
});
