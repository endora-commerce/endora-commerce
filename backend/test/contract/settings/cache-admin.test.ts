import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CacheNamespacesResponseSchema,
  ClearCacheResultSchema,
} from '@b2b/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature: admin cache maintenance.
 *
 *   GET  /api/v1/admin/cache/namespaces
 *   POST /api/v1/admin/cache/clear
 *
 * Lets an operator flush selected Redis cache namespaces so content/settings
 * changes appear without waiting for TTL expiry. Gated by settings:write.
 */
describe('Settings — admin cache maintenance', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists clearable cache namespaces', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cache/namespaces',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const parsed = CacheNamespacesResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const keys = parsed.data.data.map((n) => n.key);
      expect(keys).toContain('blog');
      expect(keys).toContain('settings');
      expect(keys).toContain('cms');
    }
  });

  it('clears selected namespaces and reports counts', async () => {
    // Seed a couple of blog cache keys directly in Redis, then clear them.
    await h.redis.set('blog:v1:test:en:index', '1');
    await h.redis.set('blog:v1:test:en:post:x', '1');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cache/clear',
      cookies: adminCookie,
      payload: { namespaces: ['blog'] },
    });
    expect(res.statusCode).toBe(200);
    const parsed = ClearCacheResultSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.data.totalDeletedKeys).toBeGreaterThanOrEqual(2);
    }
    expect(await h.redis.exists('blog:v1:test:en:index')).toBe(0);
  });

  it('rejects an empty namespaces array (400)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cache/clear',
      cookies: adminCookie,
      payload: { namespaces: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
