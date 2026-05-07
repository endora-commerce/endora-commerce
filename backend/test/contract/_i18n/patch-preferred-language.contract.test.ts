import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T019 / FR-002, FR-004, FR-006 — `PATCH /api/v1/admin/me/preferred-language`
 * contract test. Exercises the route end-to-end through Fastify's inject()
 * harness against the real test PostgreSQL. The harness already seeds
 * TEST_ADMIN_ID via seedAdmins(); the stub cookie maps to that user.
 */
describe('PATCH /api/v1/admin/me/preferred-language', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function patch(
    body: Record<string, unknown>,
    cookie: string = 'stub-admin-session',
  ): Promise<{ status: number; body: unknown }> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      headers: cookie ? { cookie: `b2b_session=${cookie}` } : {},
      payload: body,
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('accepts {preferredLanguage:"pl"} and returns the new value', async () => {
    const r = await patch({ preferredLanguage: 'pl' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { preferredLanguage: 'pl' } });
  });

  it('accepts {preferredLanguage:"en"} and returns the new value', async () => {
    const r = await patch({ preferredLanguage: 'en' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { preferredLanguage: 'en' } });
  });

  it('accepts {preferredLanguage:null} (revert to default)', async () => {
    const r = await patch({ preferredLanguage: null });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { preferredLanguage: null } });
  });

  it('saving the same value twice yields 200 (idempotent)', async () => {
    await patch({ preferredLanguage: 'pl' });
    const r = await patch({ preferredLanguage: 'pl' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { preferredLanguage: 'pl' } });
  });

  it('rejects an unsupported language code with 400', async () => {
    const r = await patch({ preferredLanguage: 'fr' });
    expect(r.status).toBe(400);
  });

  it('rejects a non-string non-null value with 400', async () => {
    const r = await patch({ preferredLanguage: 42 });
    expect(r.status).toBe(400);
  });

  it('rejects an empty body with 400', async () => {
    const r = await patch({});
    expect(r.status).toBe(400);
  });

  it('rejects unauth (no admin cookie) with 401', async () => {
    const r = await patch({ preferredLanguage: 'pl' }, '');
    expect(r.status).toBe(401);
  });
});
