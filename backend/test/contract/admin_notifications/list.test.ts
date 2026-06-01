import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Regression — `GET /api/v1/admin/notifications` 500'd with knex
 * "Expected 1 bindings, saw 0" because the raw SQL mixed Postgres `$N`
 * placeholders with a knex positional bindings array. The endpoint had no
 * test, so the unconditional 500 went unnoticed.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/notifications', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('requires an authenticated admin session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/notifications?limit=25' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a list for a stub admin (default page)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?limit=25',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { items: unknown[] }).items)).toBe(true);
  });

  it('returns a list with the unread filter', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?limit=10&unread=true',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
  });
});
