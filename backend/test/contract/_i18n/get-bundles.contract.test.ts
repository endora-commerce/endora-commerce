import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { GetBundlesResponseSchema } from '@endora-commerce/contracts';

/**
 * T032 / FR-008, FR-010 — `GET /api/v1/admin/i18n/bundles?language=…`
 * contract test. Validates response shape via the Zod schema and the
 * unsupported-language / unauth error paths.
 *
 * The harness used to skip the boot-time bundle reconciler (it passed no
 * lifecycle registry), so `bundles` came back empty unless a test seeded rows
 * itself. Issue #158 gave it the registry every deployment resolves, so the
 * response now carries every module's on-disk bundle. The shape contract below
 * is the same either way; what changed is that it is asserted over real content.
 */
describe('GET /api/v1/admin/i18n/bundles', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function get(
    query: string,
    cookie: string = 'stub-admin-session',
  ): Promise<{ status: number; body: unknown }> {
    const url =
      query !== ''
        ? `/api/v1/admin/i18n/bundles?${query}`
        : '/api/v1/admin/i18n/bundles';
    const res = await h.app.inject({
      method: 'GET',
      url,
      headers: cookie ? { cookie: `b2b_session=${cookie}` } : {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('returns 200 + a {data: GetBundlesResponse} envelope for language=en', async () => {
    const r = await get('language=en');
    expect(r.status).toBe(200);
    const env = r.body as { data: unknown };
    const parsed = GetBundlesResponseSchema.safeParse(env.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.language).toBe('en');
      expect(typeof parsed.data.version).toBe('number');
      expect(parsed.data.version).toBeGreaterThanOrEqual(0);
      expect(typeof parsed.data.bundles).toBe('object');
    }
  });

  it('returns 200 + the right language for language=pl', async () => {
    const r = await get('language=pl');
    expect(r.status).toBe(200);
    const env = r.body as { data: { language: string } };
    expect(env.data.language).toBe('pl');
  });

  it('rejects an unsupported language with 400', async () => {
    const r = await get('language=fr');
    expect(r.status).toBe(400);
  });

  it('rejects a missing language query with 400', async () => {
    const r = await get('');
    expect(r.status).toBe(400);
  });

  it('rejects unauth (no admin cookie) with 401', async () => {
    const r = await get('language=en', '');
    expect(r.status).toBe(401);
  });
});
