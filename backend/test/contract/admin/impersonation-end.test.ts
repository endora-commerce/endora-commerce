import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * T180 — `POST /admin/impersonation/end` restores the original admin session
 * (from `admin_shadow_session`) and writes the `impersonation.end` audit
 * entry. The impersonation cookie value reused after `end` MUST NOT
 * authenticate as anything (its session is destroyed).
 */

interface CookieJar {
  b2b_session?: string;
  b2b_admin_session?: string;
  admin_shadow_session?: string;
}

function parseCookies(setCookie: string | string[] | undefined): CookieJar {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const jar: CookieJar = {};
  for (const h of headers) {
    const m1 = /(?:^|; )b2b_session=([^;]+)/.exec(h);
    const m2 = /admin_shadow_session=([^;]+)/.exec(h);
    const m3 = /b2b_admin_session=([^;]+)/.exec(h);
    if (m1?.[1]) jar.b2b_session = m1[1];
    if (m2?.[1]) jar.admin_shadow_session = m2[1];
    if (m3?.[1]) jar.b2b_admin_session = m3[1];
  }
  return jar;
}

describe('POST /api/v1/admin/impersonation/end', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('restores admin session and writes impersonation.end audit entry', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const customerId = '00000000-0000-4000-8000-0000000000a1';

    // 0. Real admin login → real session cookie. End() validates this shadow
    // via SessionService, so we can't use the stub-admin-session string here.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: {
        email: 'platform-admin@example.com',
        password: 'stub-password-change-me-1234',
      },
    });
    expect(login.statusCode).toBe(200);
    const adminSession = parseCookies(login.headers['set-cookie']).b2b_admin_session!;

    // Start impersonation with the real admin session (admin cookie).
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/impersonate`,
      payload: { customerAccountId: customerId },
      cookies: { b2b_admin_session: adminSession },
    });
    expect(start.statusCode).toBe(200);
    const startCookies = parseCookies(start.headers['set-cookie']);
    expect(startCookies.b2b_session).toBeDefined();
    expect(startCookies.admin_shadow_session).toBeDefined();
    const impersonationCookie = startCookies.b2b_session!;
    const shadow = startCookies.admin_shadow_session!;

    // End impersonation.
    const before = await h.em().count(AuditLogEntry, { action: 'impersonation.end' });
    const end = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/impersonation/end',
      cookies: {
        b2b_session: impersonationCookie,
        admin_shadow_session: shadow,
      },
    });
    expect(end.statusCode).toBe(200);
    const after = await h.em().count(AuditLogEntry, { action: 'impersonation.end' });
    expect(after).toBe(before + 1);

    // The original admin session is restored into the admin cookie; the
    // impersonation `b2b_session` is cleared and so is `admin_shadow_session`.
    const endCookies = parseCookies(end.headers['set-cookie']);
    expect(endCookies.b2b_admin_session).toBeDefined();
    expect(endCookies.b2b_admin_session).not.toBe(impersonationCookie);
  });
});
