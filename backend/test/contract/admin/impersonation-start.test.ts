import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

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
