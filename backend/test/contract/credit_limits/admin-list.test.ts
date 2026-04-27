import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T218 — `GET /api/v1/admin/credit-limits` lists every granted credit
 * limit so the admin Credit Limits UI can render a roster. Anonymous /
 * insufficient-permission callers get rejected.
 */

describe('GET /api/v1/admin/credit-limits', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns an empty list when no limits have been granted', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('after a grant, the row appears in the list', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const grant = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { grantedAmount: 5000, currency: 'PLN' },
    });
    expect(grant.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ organizationId: string; grantedAmount: number; currency: string }>;
    };
    const row = body.data.find((d) => d.organizationId === orgId);
    expect(row).toBeDefined();
    expect(row!.grantedAmount).toBe(5000);
    expect(row!.currency).toBe('PLN');
  });

  it('rejects anonymous callers', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credit-limits' });
    expect(res.statusCode).toBe(401);
  });
});
