import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The four `degrades-without` edges, each with the owner switched off — D-44
 * §10, and the risk it names in as many words:
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
   * `customers` → `orders:orderListServiceAccessor`, whenAbsent: *order history
   * is empty on the self-service and admin customer panels*.
   *
   * The accessor's `() => OrderListService | null` return type looks like it
   * already tolerates an absent `orders`, and that is the trap: it is a gated
   * port, so an operator who switches `orders` off makes the resolution throw
   * before the `null` check is ever reached. The declared behaviour is an empty
   * page — the same page a customer with no orders sees.
   */
  describe('customers → orders:orderListServiceAccessor', () => {
    it('answers an empty self-service order history rather than failing', async () => {
      deactivate('orders');

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
      deactivate('orders');

      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/orders`,
        cookies: ADMIN,
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('leaves the rest of the customer surface serving', async () => {
      deactivate('orders');

      // Same guard as on the `catalog` edge: an empty history proves nothing if
      // the whole module has stopped answering.
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer',
        cookies: CUSTOMER,
      });
      expect(res.statusCode).toBe(200);
    });

    it('lists orders again once the module is switched back on', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer/orders',
        cookies: CUSTOMER,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  it('exercises the deactivated-while-platform-available case throughout', () => {
    // Constitution XVII checklist item 6 asks for this case specifically, and
    // it is the one the four edges above are written for: a module the
    // deployment still ships, that the business has switched off. A test that
    // simulated a missing installation would prove something else.
    for (const moduleId of ['api_keys', 'orders']) {
      deactivate(moduleId);
      const presence = effectiveState.presence(moduleId);
      expect(presence?.platformAvailable, `${moduleId} platform axis`).toBe(true);
      expect(presence?.operatorActivated, `${moduleId} operator axis`).toBe(false);
      expect(effectiveState.isPresent(moduleId), `${moduleId} effective presence`).toBe(false);
    }
  });
});
