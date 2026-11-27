import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EffectiveFormsResponseSchema } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * `specs/193-admin-form-extensions/` T024 (FR-023) — `GET /api/v1/admin/effective-forms`
 * on the composed platform: `_lifecycle` mounts it wherever the root composes a
 * form registry, behind an authenticated admin with no permission code, with
 * an ETag the admin revalidates with. The layering, presence and memo cases are
 * the platform's own (`packages/platform/src/lifecycle/routes.admin.forms.test.ts`);
 * this file holds the composition to serving it at all, and to an empty answer
 * while no core host has adopted (D-300.5 lands the hosts in later work packages).
 */

describe('GET /api/v1/admin/effective-forms on the composed platform (193 T024)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a request with no admin session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/effective-forms' });
    expect(res.statusCode).toBe(401);
  });

  it('answers the effective forms with an ETag, and 304 when it still matches', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/effective-forms', cookies: { b2b_session: 'stub-admin-session' } });
    expect(res.statusCode).toBe(200);
    const body = EffectiveFormsResponseSchema.parse(res.json());
    expect(Array.isArray(body.forms)).toBe(true);
    const etag = res.headers['etag'];
    expect(typeof etag).toBe('string');

    const again = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/effective-forms',
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-none-match': String(etag) },
    });
    expect(again.statusCode).toBe(304);
  });
});
