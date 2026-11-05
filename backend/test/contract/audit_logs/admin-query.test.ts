import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * T195 — `GET /api/v1/admin/audit-log` returns the append-only log with
 * filters by actor / action / objectType / objectId. The query is gated by
 * the `audit_log:read` permission.
 */

describe('GET /api/v1/admin/audit-log', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Trigger an audit row by mutating a product.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}`,
      // Feature 002 (T023) — attributeValues keys MUST belong to the
      // Product's AttributeSet. `internal_sku_notes` is seeded in the
      // foundation test seed and assigned to the system Default set.
      payload: { attributeValues: { internal_sku_notes: 'audit-trigger' } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the audit log filtered by action', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?filter[action]=product.update',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ action: string; objectType: string; objectId: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach((entry) => expect(entry.action).toBe('product.update'));
    expect(body.data.some((e) => e.objectId === SEED_PRODUCT_101_ID)).toBe(true);
  });

  it('returns the audit log filtered by objectId', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${SEED_PRODUCT_101_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ objectId: string }> };
    body.data.forEach((entry) => expect(entry.objectId).toBe(SEED_PRODUCT_101_ID));
  });

  /**
   * Issue #741 (`specs/170-organization-roles/` FR-065, R-21): a storefront
   * administrator's change is recorded with the acting customer, and the read
   * returns that customer — the Organization's *History* used to show the row
   * as "system", because the read dropped the column.
   */
  it('names the customer who acted on the storefront', async () => {
    const email = `audit-actor-${randomUUID().slice(0, 8)}@example.com`;
    const invited = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const invitationId = (invited.json() as { data: { invitationId: string } }).data.invitationId;

    const res = await h.app.inject({
      method: 'GET',
      url:
        '/api/v1/admin/audit-log?filter[action]=organization_invitation.create' +
        `&filter[objectType]=organization&filter[objectId]=${TEST_ORGANIZATION_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{
        actorAdminUserId: string | null;
        actorCustomerAccountId: string | null;
        actorCustomerLabel: string | null;
        impersonatedCustomerAccountId: string | null;
        stateAfter: Record<string, unknown> | null;
      }>;
    };
    const entry = body.data.find((e) => e.stateAfter?.['invitationId'] === invitationId);
    const [account] = (await h.em().getConnection().execute(
      `select "first_name", "last_name", "email" from "customer_accounts" where "id" = ?`,
      [CUSTOMER_COOKIES['stub-customer-session']!.customerAccountId],
    )) as Array<{ first_name: string; last_name: string; email: string }>;
    const personLabel = `${account!.first_name} ${account!.last_name} (${account!.email})`;
    expect(entry).toMatchObject({
      actorAdminUserId: null,
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: CUSTOMER_COOKIES['stub-customer-session']!.customerAccountId,
      // The customer-account audit reference names the person (owner ruling on PR #744).
      actorCustomerLabel: personLabel,
    });
  });

  it('rejects callers without audit_log:read scope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log',
      cookies: { b2b_session: 'stub-restricted-admin-session' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
