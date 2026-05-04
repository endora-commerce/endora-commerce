import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 011 / US4 — Rule-target picker endpoints contract (T052).
 *
 * Read-only helpers consumed by the admin rule builder.
 */
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Rule-target picker endpoints (feature 011 US4)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /sales-channels returns the channel list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/rule-targets/sales-channels',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: Array<{ id: string; code: string }> } };
    expect(Array.isArray(body.data.items)).toBe(true);
    // The seeded data always has at least one channel.
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it('GET /customer-groups returns the group list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/rule-targets/customer-groups',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: Array<{ id: string; code: string }> } };
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  it('GET /organizations returns paginated organizations with optional search', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/rule-targets/organizations?limit=50',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { items: Array<{ id: string; name: string; taxId: string }>; nextCursor: string | null };
    };
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  it('GET /categories returns the category tree shape', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/rule-targets/categories',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        items: Array<{
          id: string;
          slug: string;
          parentCategoryId: string | null;
          sortOrder: number;
        }>;
      };
    };
    expect(Array.isArray(body.data.items)).toBe(true);
    if (body.data.items.length > 0) {
      const head = body.data.items[0];
      expect(typeof head?.slug).toBe('string');
      expect(typeof head?.sortOrder).toBe('number');
    }
  });

  it('GET /currencies aggregates channel currencies across the platform', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/rule-targets/currencies',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { items: Array<{ code: string; exposedByChannels: string[] }> };
    };
    expect(Array.isArray(body.data.items)).toBe(true);
    for (const it of body.data.items) {
      expect(it.code).toMatch(/^[A-Z]{3}$/);
      expect(Array.isArray(it.exposedByChannels)).toBe(true);
    }
  });

  it('rule-target endpoints reject unauthenticated callers', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pricing/rule-targets/sales-channels',
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
