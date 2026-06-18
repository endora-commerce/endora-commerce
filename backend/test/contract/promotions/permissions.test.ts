import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 (US8) — promotion routes are gated by promotions:read/write/
 * delete. An admin lacking the permission is rejected.
 */
describe('Promotion permission enforcement (feature 045)', () => {
  let h: BackendServerHandle;
  // readOnlyRole carries only `orders:read` — no promotions:* codes.
  const restricted = { b2b_session: 'stub-restricted-admin-session' };
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects reads without promotions:read', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/v1/admin/promotions', cookies: restricted });
    expect(r.statusCode).toBe(403);
  });

  it('rejects writes without promotions:write', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: restricted,
      payload: { name: 'x', action: { type: 'free_delivery' }, rule: { kind: 'all' } },
    });
    expect(r.statusCode).toBe(403);
  });

  it('allows reads with full permissions', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/v1/admin/promotions', cookies: admin });
    expect(r.statusCode).toBe(200);
  });

  it('rejects rule management and stats without permission', async () => {
    const rules = await h.app.inject({ method: 'GET', url: '/api/v1/admin/promotion-rules', cookies: restricted });
    expect(rules.statusCode).toBe(403);
  });
});
