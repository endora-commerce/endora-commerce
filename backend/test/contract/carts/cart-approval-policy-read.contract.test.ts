import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The operator's per-Organization cart-approval policy is removed
 * (`specs/170-organization-roles/` WP-04, T071; OR-3, FR-031).
 *
 * `GET` and `PATCH /api/v1/admin/organizations/:id/cart-approval-policy` were
 * the read and write behind `CartApprovalPolicyPanel` on the Organization
 * detail (feature 091, P7b). Whether a buyer's basket needs approval is now the
 * buyer's role (`carts.order_without_approval`), which the Organization's
 * administrator edits on the storefront, so neither route is served — for an
 * operator holding `customers:manage` as for anyone — and the admin zone that
 * called them is gone with them.
 */
describe('the operator cart-approval policy routes are removed', () => {
  let h: BackendServerHandle;
  const url = `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/cart-approval-policy`;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET answers 404 to an operator who holds every permission', async () => {
    const res = await h.app.inject({ method: 'GET', url, cookies: { b2b_session: 'stub-admin-session' } });
    expect(res.statusCode, res.body).toBe(404);
  });

  it('PATCH answers 404 and changes nothing', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url,
      payload: { requiresCartApproval: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});
