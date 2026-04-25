import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedSuspendedOrganization } from '../../helpers/seed-commerce.js';

/**
 * T099 — `POST /orders` on a suspended Organization must return 423
 * ORGANIZATION_SUSPENDED. Members of a suspended Organization can read the
 * catalog but cannot place Orders or RFQs.
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

  it('returns 423 ORGANIZATION_SUSPENDED', async () => {
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
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ORGANIZATION_SUSPENDED);
  });
});
