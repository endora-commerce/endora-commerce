import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedSuspendedOrganization } from '../../helpers/seed-commerce.js';

/**
 * T099 — `POST /orders` on a suspended Organization must be refused with 423.
 * Members of a suspended Organization can read the catalog but cannot place
 * Orders or RFQs.
 *
 * The code is `FORBIDDEN` carrying `details.code = 'organization_cannot_transact'`,
 * which is what `specs/062-distributor-api/contracts/orders-api-key-intake.md`
 * and the published `docs/docs/integrations/api-access.md` both specify, and
 * what the three sibling surfaces (external orders, RFQ submission, cart
 * mutation) already emit.
 *
 * Until feature 072 T141 this asserted `ORGANIZATION_SUSPENDED`, and passed —
 * because the test harness never wired `assertOrganizationCanTransact`, so the
 * request fell past the route gate to `OrderService`'s own service-seam check.
 * Production has always wired the gate, so the suite was pinning a code
 * production does not emit here. Wiring the guard through the container made
 * both compositions take the same path and the assertion had to follow.
 */

describe('POST /api/v1/orders — suspended Organization', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedSuspendedOrganization(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 423 FORBIDDEN with the organization_cannot_transact detail', async () => {
    // Fixture: tests suspend the TEST_ORGANIZATION before hitting this endpoint
    // once the organizations module is wired up (Phase 4b). The current assertion
    // probes the contract shape.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: 'stub-customer-session-suspended' },
    });
    expect(res.statusCode).toBe(423);
    const body = res.json() as {
      error: { code: string; details?: { code?: string; status?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
    // The detail is the part the contract names — `FORBIDDEN` alone is shared
    // with every other refusal, so asserting only the code would pass against
    // an ordinary permission failure.
    expect(body.error.details?.code).toBe('organization_cannot_transact');
    // `blocked`, not `suspended` — `seedSuspendedOrganization` is named for the
    // user-facing concept and seeds the `blocked` status that carries it.
    expect(body.error.details?.status).toBe('blocked');
  });
});
