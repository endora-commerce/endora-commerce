import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const SALES_REP_ASSIGNER_ID = '00000000-0000-4000-8000-0000000000d5';
const RFQ_HANDLER_ID = '00000000-0000-4000-8000-0000000000d6';

/**
 * T073 — Sales-rep ↔ organization assignment endpoints.
 *
 * Since D-166 the four endpoints have two owners and two permission codes, and
 * the second `describe` below is the proof that they really are two: the three
 * assignment endpoints are `organizations`' under a new
 * `organizations:assign-sales-rep`, and the reverse listing — the only one that
 * reads a `QuoteRequest` — stays `quote_requests`' under `rfqs:handle`. A role
 * holding one code must be refused the other side, or the split is a rename.
 */
describe('Sales-rep assignment routes (US7)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists no assignments on a fresh organization', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('assigns a sales rep then lists it', async () => {
    const post = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    expect(post.statusCode).toBe(201);
    const created = (post.json() as { data: { adminUserId: string; organizationId: string } }).data;
    expect(created.adminUserId).toBe(TEST_ADMIN_ID);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ adminUserId: string }> };
    expect(body.data.find((r) => r.adminUserId === TEST_ADMIN_ID)).toBeTruthy();
  });

  it('reverse-lists organizations a sales rep is assigned to', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string }> };
    expect(body.data.find((o) => o.organizationId === TEST_ORGANIZATION_ID)).toBeTruthy();
  });

  it('unassigns and 404s on subsequent unassign', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);
    const del2 = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del2.statusCode).toBe(404);
  });

  it('returns 404 when assigning a non-existent admin user', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: '00000000-0000-4000-8000-00000000ffff' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Sales-rep routes are gated by their own owner\'s code (D-166)', () => {
  let h: BackendServerHandle;
  const assigner = { b2b_session: 'stub-sales-rep-assigner-session' };
  const rfqHandler = { b2b_session: 'stub-rfq-handler-session' };
  const restricted = { b2b_session: 'stub-restricted-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const assignerRole = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/sales_rep_assigner',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'sales_rep_assigner',
        name: 'Sales-rep assigner',
        permissions: ['organizations:assign-sales-rep'],
      },
    });
    expect(assignerRole.statusCode).toBe(200);
    const assignerRoleId = (assignerRole.json() as { data: { id: string } }).data.id;

    const handlerRole = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/rfq_handler_only',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'rfq_handler_only',
        name: 'RFQ handler',
        permissions: ['rfqs:handle'],
      },
    });
    expect(handlerRole.statusCode).toBe(200);
    const handlerRoleId = (handlerRole.json() as { data: { id: string } }).data.id;

    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
    em.create(AdminUser, {
      id: SALES_REP_ASSIGNER_ID,
      email: 'sales-rep-assigner@example.com',
      passwordHash,
      firstName: 'Sales',
      lastName: 'Assigner',
      adminRoleId: assignerRoleId,
      status: 'active',
    });
    em.create(AdminUser, {
      id: RFQ_HANDLER_ID,
      email: 'rfq-handler-only@example.com',
      passwordHash,
      firstName: 'Rfq',
      lastName: 'Handler',
      adminRoleId: handlerRoleId,
      status: 'active',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('opens the three assignment endpoints for organizations:assign-sales-rep', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: assigner,
    });
    expect(list.statusCode).toBe(200);

    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: assigner,
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    expect(assign.statusCode).toBe(201);

    const unassign = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}`,
      cookies: assigner,
    });
    expect(unassign.statusCode).toBe(204);
  });

  it('refuses the reverse listing to organizations:assign-sales-rep alone', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations`,
      cookies: assigner,
    });
    expect(res.statusCode).toBe(403);
  });

  it('opens the reverse listing for rfqs:handle', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations`,
      cookies: rfqHandler,
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses the three assignment endpoints to rfqs:handle alone', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: rfqHandler,
    });
    expect(list.statusCode).toBe(403);

    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: rfqHandler,
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    expect(assign.statusCode).toBe(403);
  });

  it('refuses every one of the four to an admin holding neither code', async () => {
    for (const call of [
      { method: 'GET' as const, url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps` },
      { method: 'DELETE' as const, url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}` },
      { method: 'GET' as const, url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations` },
    ]) {
      const res = await h.app.inject({ ...call, cookies: restricted });
      expect(res.statusCode).toBe(403);
    }
  });
});
