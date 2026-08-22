import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T154 — `GET /api/v1/me` returns the authenticated customer + their
 * organization. Anonymous callers get 401 UNAUTHORIZED.
 */

describe('GET /api/v1/me', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the authenticated customer + their organization', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        customerAccount: { id: string; email: string; role: string; organizationId: string };
        organization: { id: string; name: string; status: string };
      };
    };
    expect(body.data.customerAccount.id).toBeTruthy();
    expect(body.data.customerAccount.email).toContain('@');
    expect(body.data.organization.id).toBe(body.data.customerAccount.organizationId);
  });

  it('rejects anonymous callers with 401 UNAUTHORIZED', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});
