import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * T193 — Admin role CRUD + permissions catalogue exposure. Validates the
 * role-in-use guard (can't delete a role that still has assignees) and the
 * unknown-permission guard.
 */

describe('Admin roles CRUD', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('exposes the canonical permissions catalogue', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/permissions',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ code: string; module: string }> };
    // +2 for feature 042 MFA codes (mfa:reset, mfa:manage).
    // +1 for feature 043 (prompt_actions:use).
    // +3 for feature 045 promotions (promotions:read, :write, :delete).
    // +3 for feature 046 PWA (pwa:read, pwa:write, pwa:send_push).
    // +2 for feature 046 returns (returns:read, returns:write).
    // +2 for feature 047 transactional emails (transactional_emails:read, :write).
    // +2 for feature 047 invoices (invoices:read, invoices:write).
    // +2 for feature 048 newsletter (newsletter:read, newsletter:write).
    // +2 for feature 049 google_analytics (google_analytics:read, :write).
    // +2 for feature 049 stripe (stripe:read, stripe:write).
    // +2 for feature 055 custom fields (custom_fields:read, custom_fields:write).
    // +1 for feature 056 hierarchical organizations (organizations:rollup).
    // +2 for feature 058 credentials (credentials:read, credentials:write).
    // +2 for feature 059 KSeF (ksef:read, ksef:write).
    // +2 for feature 063 LinkedIn Ads (linkedin_ads:read, linkedin_ads:write).
    // +2 for feature 064 Meta Ads (meta_ads:read, meta_ads:write).
    // +2 for feature 063 TPay (tpay:read, tpay:write).
    // +2 for feature 065 PayU (payu:read, payu:write).
    // +2 for feature 067 Product Feed (product_feeds:read, product_feeds:write).
    // +2 for feature 067 Autopay (autopay:read, autopay:write).
    // +2 for feature 068 Ergonode PIM (pim_ergonode:read, pim_ergonode:write).
    expect(body.data.length).toBe(71);
    expect(body.data.some((p) => p.code === 'promotions:write')).toBe(true);
    expect(body.data.some((p) => p.code === 'stripe:write')).toBe(true);
    expect(body.data.some((p) => p.code === 'tpay:write')).toBe(true);
    expect(body.data.some((p) => p.code === 'payu:write')).toBe(true);
    expect(body.data.some((p) => p.code === 'autopay:write')).toBe(true);
    expect(body.data.some((p) => p.code === 'mfa:reset')).toBe(true);
    expect(body.data.some((p) => p.code === 'orders:read')).toBe(true);
    expect(body.data.some((p) => p.code === 'settings:read')).toBe(true);
    expect(body.data.some((p) => p.code === 'cms.read')).toBe(true);
    expect(body.data.some((p) => p.code === 'assets.read')).toBe(true);
  });

  it('upserts a role by code, then deletes it once unassigned', async () => {
    const upsert = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/order_manager',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'order_manager',
        name: 'Order manager',
        permissions: ['orders:read', 'orders:write'],
      },
    });
    expect(upsert.statusCode).toBe(200);
    const role = (upsert.json() as { data: { id: string; permissions: string[] } }).data;
    expect(role.permissions).toEqual(['orders:read', 'orders:write']);

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/order_manager',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'order_manager',
        name: 'Order manager (updated)',
        permissions: ['orders:read'],
      },
    });
    expect(update.statusCode).toBe(200);
    expect((update.json() as { data: { permissions: string[] } }).data.permissions).toEqual([
      'orders:read',
    ]);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${role.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);
  });

  it('accepts the wildcard and normalises it to exactly ["*"]', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/super_role',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'super_role',
        name: 'Super role',
        // Mixed wildcard + explicit codes collapse to just the wildcard.
        permissions: ['*', 'orders:read'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { permissions: string[] } }).data.permissions).toEqual(['*']);
  });

  it('locks platform_admin to the wildcard regardless of payload', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/platform_admin',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'platform_admin',
        name: 'Platform Admin',
        permissions: ['orders:read'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { permissions: string[] } }).data.permissions).toEqual(['*']);
  });

  it('rejects an unknown permission with VALIDATION_FAILED', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/bad_role',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'bad_role',
        name: 'Bad role',
        permissions: ['nonexistent:permission'],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses to delete a role with assignees (ADMIN_ROLE_IN_USE)', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${READ_ONLY_ROLE_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ADMIN_ROLE_IN_USE);
  });
});
