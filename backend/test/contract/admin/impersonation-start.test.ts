import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * T179 — `POST /admin/organizations/:id/impersonate` writes an
 * AuditLogEntry with `action='impersonation.start'` BEFORE returning the
 * impersonation cookie. A partial failure leaves no dangling cookie.
 */

describe('POST /api/v1/admin/organizations/:id/impersonate — audit-before-cookie', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes the impersonation.start audit entry and sets the impersonation cookie', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const customerId = '00000000-0000-4000-8000-0000000000a1';

    const before = await h.em().count(AuditLogEntry, { action: 'impersonation.start' });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/impersonate`,
      payload: { customerAccountId: customerId, reason: 'support ticket #42' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);

    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    expect(cookies.some((c) => /b2b_session=/.test(c))).toBe(true);
    expect(cookies.some((c) => /admin_shadow_session=/.test(c))).toBe(true);

    const after = await h.em().count(AuditLogEntry, { action: 'impersonation.start' });
    expect(after).toBe(before + 1);

    const entry = await h.em().findOne(
      AuditLogEntry,
      { action: 'impersonation.start' },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entry).not.toBeNull();
    expect(entry!.impersonatedCustomerAccountId).toBe(customerId);
  });
});

/**
 * Issue #828 — the `customers:impersonate` gate answers before the body schema,
 * as it does on `POST /admin/customers/:id/impersonate`. A caller the route
 * refuses learns nothing about its request shape: a malformed
 * `customerAccountId` and a well-formed one get the same 403, and nothing is
 * audited for either.
 */
describe('POST /api/v1/admin/organizations/:id/impersonate — the gate before the schema', () => {
  let h: BackendServerHandle;
  let nobody: { cookies: { b2b_session: string }; undo: () => void };
  const orgId = '00000000-0000-4000-8000-0000000000aa';
  const customerId = '00000000-0000-4000-8000-0000000000a1';

  beforeAll(async () => {
    h = await setupBackendServer();
    nobody = await seedCrmAdmin(h.em(), 'impersonate-nobody', ['orders:read']);
  });

  afterAll(async () => {
    nobody?.undo();
    await teardownBackendServer(h);
  });

  function impersonate(payload: Record<string, unknown>, cookies?: Record<string, string>) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/impersonate`,
      payload,
      ...(cookies ? { cookies } : {}),
    });
  }

  it.each([
    ['a well-formed customerAccountId', { customerAccountId: customerId }],
    ['a malformed customerAccountId', { customerAccountId: 'not-a-uuid' }],
    ['no customerAccountId at all', {}],
  ])('answers 403 without customers:impersonate for %s', async (_label, payload) => {
    const before = await h.em().count(AuditLogEntry, { action: 'impersonation.start' });
    const res = await impersonate(payload, nobody.cookies);
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    expect(await h.em().count(AuditLogEntry, { action: 'impersonation.start' })).toBe(before);
  });

  it('answers 401 without a session, whatever the body', async () => {
    const res = await impersonate({ customerAccountId: 'not-a-uuid' });
    expect(res.statusCode, res.body).toBe(401);
  });

  it('still validates the body for a caller who holds the permission', async () => {
    const res = await impersonate(
      { customerAccountId: 'not-a-uuid' },
      { b2b_session: 'stub-admin-session' },
    );
    expect(res.statusCode, res.body).toBe(400);
  });
});
