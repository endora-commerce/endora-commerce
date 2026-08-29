import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedShippedOrder } from '../../helpers/seed-commerce.js';

/**
 * T101 — Admin status-transition graph is enforced (FR-014).
 * `shipped → new` is a backwards move and must return 409 INVALID_TRANSITION.
 */

describe('POST /api/v1/admin/orders/:id/status — invalid transition', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedShippedOrder(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 409 INVALID_TRANSITION when attempting shipped → new', async () => {
    // Fixture: an Order already in 'shipped' state with id below.
    const orderId = '00000000-0000-4000-8000-0000000003ff';
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'new' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.INVALID_TRANSITION);
  });
});
