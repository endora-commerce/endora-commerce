import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cartApprovalPolicyResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `GET /api/v1/admin/organizations/:id/cart-approval-policy` — the read half of
 * a policy that had only a write (feature 091, P7b;
 * `contracts/admin-component-contribution.md` §10.5).
 *
 * `carts` owned the `PATCH` and no `GET`, so the one value that crossed into
 * `organizations`' `CartApprovalPolicyPanel` was `initialRequiresCartApproval`
 * — a prop out of the organization detail payload. A zone's props may not carry
 * it (Z3: the other three contributors to `organization.detail.after` want
 * neither prop), so the contribution reads its own initial state, and §10.5
 * ruled that it does so from a route of `carts`' own rather than by parsing a
 * payload `organizations` owns for one boolean.
 *
 * **Gated on `customers:manage`, which is what the `PATCH` beside it
 * enforces.** Gating the read on `carts:read` would let the contribution render
 * a toggle that 403s on its first use, which is the thing a contribution's
 * `requiredPermission` exists to prevent — and a contribution declares one code.
 *
 * The response is `cartApprovalPolicyResponseSchema`, the shape the `PATCH`
 * already answers with: read and write agree on one contract as well as on one
 * code.
 */
describe('GET /api/v1/admin/organizations/:id/cart-approval-policy', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers the current policy in the same shape the PATCH answers', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/cart-approval-policy`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = cartApprovalPolicyResponseSchema.parse(res.json());
    expect(parsed.data.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(typeof parsed.data.requiresCartApproval).toBe('boolean');
  });

  it('reads back what the PATCH wrote', async () => {
    const write = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/cart-approval-policy`,
      payload: { requiresCartApproval: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(write.statusCode).toBe(200);

    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/cart-approval-policy`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(read.statusCode).toBe(200);
    expect(cartApprovalPolicyResponseSchema.parse(read.json()).data.requiresCartApproval).toBe(
      true,
    );

    // Put the fixture back, so a file that runs after this one in the same
    // database sees the organisation it was seeded with.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/cart-approval-policy`,
      payload: { requiresCartApproval: false },
      cookies: { b2b_session: 'stub-admin-session' },
    });
  });

  it('is 404 for an organization that does not exist', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/00000000-0000-4000-8000-0000000009ff/cart-approval-policy',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is 401 for an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/cart-approval-policy`,
    });
    expect(res.statusCode).toBe(401);
  });
});
