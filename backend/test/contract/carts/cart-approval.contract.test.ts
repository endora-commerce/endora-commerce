import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T078-T083 (feature 027 US4) — Approval workflow smoke contract tests.
 *
 * Route plumbing and the error-handler contract for the anonymous-session
 * paths; the member and approver paths are
 * `backend/test/integration/carts/cart-approval-flow.test.ts`.
 *
 * `specs/170-organization-roles/` WP-04 (OR-3, FR-031) — the per-Organization
 * policy switch is gone: whether a buyer's basket needs approval is their
 * role's `carts.order_without_approval`, so
 * `PATCH /api/v1/organization/policies/cart-approval` is not served at all.
 */

describe('US4 approval routes — anonymous paths, and the removed policy switch', () => {
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

  it('PATCH /api/v1/organization/policies/cart-approval is removed: 404, even for an administrator', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization/policies/cart-approval',
      payload: JSON.stringify({ requiresCartApproval: true }),
      headers: { 'content-type': 'application/json' },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});
