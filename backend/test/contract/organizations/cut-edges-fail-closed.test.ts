import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 075, Phase C — the `organizations` cut fails closed.
 *
 * Thirty-nine import sites became port resolutions, and the point of the
 * exercise is not the specifier: it is that a read whose owner is absent now
 * **refuses** where it used to answer. `em.find(PriceList, …)` cheerfully
 * returned rows from a table that is still there; `priceListReadPort.listActive()`
 * answers 503 `MODULE_DISABLED`.
 *
 * Two edges are probed rather than all of them, and they are chosen for what
 * they distinguish:
 *
 *  - **`price_lists`** — the reply an operator would otherwise misread. An
 *    empty `items` array on the applicable-price-lists panel is a plausible
 *    answer ("nothing applies to this organisation") and the wrong one.
 *  - **`customer_accounts`** — the identity read behind `GET /api/v1/me`,
 *    which used to load that module's entity directly.
 *
 * Both providers declare themselves `nonDeactivatable`, so the operator axis
 * has no off state for either; the platform axis is the one a deployment that
 * does not ship the module reaches, and it is the one driven here.
 * `withModuleOff` asserts the flip took before the body observes anything
 * (issue #141), and restores in its own `finally`.
 */
describe('organizations — the cut edges fail closed (feature 075, Phase C)', () => {
  let h: BackendServerHandle;
  let orgId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Fail-Closed Co',
      taxId: `PL075C${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Zamknięta 1',
        city: 'Warszawa',
        postalCode: '00-009',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const applicablePriceLists = (): Promise<{ statusCode: number; json: () => unknown }> =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    }) as unknown as Promise<{ statusCode: number; json: () => unknown }>;

  it('refuses the applicable-price-lists panel while `price_lists` is unavailable', async () => {
    // Positive control: without it, an always-broken route would read as a
    // successful absence.
    const before = await applicablePriceLists();
    expect(before.statusCode).toBe(200);

    await withModuleOff('price_lists', 'platform-unavailable', async () => {
      const res = await applicablePriceLists();
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    const restored = await applicablePriceLists();
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the customer profile read while `customer_accounts` is unavailable', async () => {
    const probe = (): Promise<{ statusCode: number; json: () => unknown }> =>
      h.app.inject({
        method: 'GET',
        url: '/api/v1/me',
        cookies: { b2b_session: 'stub-customer-session' },
      }) as unknown as Promise<{ statusCode: number; json: () => unknown }>;

    const before = await probe();
    expect((before.json() as { error?: { code?: string } }).error?.code).not.toBe(
      'MODULE_DISABLED',
    );

    await withModuleOff('customer_accounts', 'platform-unavailable', async () => {
      const res = await probe();
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    const restored = await probe();
    expect((restored.json() as { error?: { code?: string } }).error?.code).not.toBe(
      'MODULE_DISABLED',
    );
  });
});
