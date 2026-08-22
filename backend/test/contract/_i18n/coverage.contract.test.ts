import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  I18nCoverageResponseSchema,
  ERROR_CODES,
} from '@endora-commerce/contracts';

/**
 * Feature 021 — `GET /api/v1/admin/i18n/coverage` contract test.
 *
 * Validates the response shape via the Zod schema, the query-param
 * filtering surface, and the unauthorised path.
 */
describe('GET /api/v1/admin/i18n/coverage', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function get(
    query: string,
    cookie: string | null = 'stub-admin-session',
  ): Promise<{ status: number; body: unknown }> {
    const url =
      query !== ''
        ? `/api/v1/admin/i18n/coverage?${query}`
        : '/api/v1/admin/i18n/coverage';
    const res = await h.app.inject({
      method: 'GET',
      url,
      headers: cookie ? { cookie: `b2b_session=${cookie}` } : {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('returns 200 + a {data: I18nCoverageResponse} envelope without filters', async () => {
    const r = await get('');
    expect(r.status).toBe(200);
    const env = r.body as { data: unknown };
    const parsed = I18nCoverageResponseSchema.safeParse(env.data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(typeof parsed.data.capturedAt).toBe('string');
      expect(Array.isArray(parsed.data.modules)).toBe(true);
      for (const m of parsed.data.modules) {
        expect(typeof m.moduleId).toBe('string');
        for (const l of m.languages) {
          expect(['en', 'pl']).toContain(l.languageCode);
          expect(l.missingCount).toBeGreaterThanOrEqual(0);
          expect(l.fellBackToEnCount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('honours the `language` query filter — only returns the listed language', async () => {
    const r = await get('language=pl');
    expect(r.status).toBe(200);
    const env = r.body as { data: { modules: Array<{ languages: Array<{ languageCode: string }> }> } };
    for (const m of env.data.modules) {
      for (const l of m.languages) {
        expect(l.languageCode).toBe('pl');
      }
    }
  });

  it('honours the `module` query filter — empty when the module is unknown', async () => {
    const r = await get('module=__does_not_exist__');
    expect(r.status).toBe(200);
    const env = r.body as { data: { modules: unknown[] } };
    expect(env.data.modules).toEqual([]);
  });

  it('returns 400 VALIDATION_FAILED for an unsupported language code', async () => {
    const r = await get('language=de');
    expect(r.status).toBe(400);
    const env = r.body as { error: { code: string } };
    expect(env.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('returns 401 UNAUTHORIZED without a session', async () => {
    const r = await get('', null);
    expect(r.status).toBe(401);
  });
});
