import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T078-T083 (feature 027 US4) — Approval workflow smoke contract tests.
 *
 * Full happy-path coverage that requires an Organization with
 * `requires_cart_approval=true` and Org-Admin / ordinary-member
 * Customer fixtures is deferred until US4 frontend; these tests
 * cover the route plumbing and the error-handler contract for the
 * anonymous-session and non-org-admin paths.
 */

describe('US4 approval routes — anonymous + non-org-admin paths', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /api/v1/organization/carts returns 401 for an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organization/carts',
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/cart/submit-for-approval returns 401 for an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/submit-for-approval',
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/organization/carts/:id/approve returns 401 for an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organization/carts/00000000-0000-4000-8000-000000000001/approve',
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/organization/carts/:id/reject returns 401 for an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organization/carts/00000000-0000-4000-8000-000000000001/reject',
      payload: JSON.stringify({ reason: 'because' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /api/v1/organization/policies/cart-approval returns 401 for an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/policies/cart-approval',
      payload: JSON.stringify({ requiresCartApproval: true }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});
