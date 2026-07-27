import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 058 US4 (T051) — a stale `expectedVersion` is rejected (409), and no
 * read path (list / detail / preview) ever returns a plaintext secret (SC-003).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'concurrency-llm';
const SECRET = 'sk-never-leaks';

describe('Credentials concurrency + masking [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'Concurrency LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: SECRET, model: 'm1' },
      },
      ...ADMIN,
    });
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects a stale expectedVersion with 409', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/credentials/${CODE}`,
      payload: { name: 'stale write', expectedVersion: 999 },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(409);
  });

  it('never returns a plaintext secret on list / detail / preview', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials', ...ADMIN });
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/credentials/${CODE}`, ...ADMIN });
    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/credentials/${CODE}/preview`,
      ...ADMIN,
    });

    for (const res of [list, detail, preview]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SECRET);
    }

    // The secret field is present as isSet-only (no value key).
    const dto = detail.json() as { fields: { key: string; secret: boolean; isSet?: boolean; value?: unknown }[] };
    const apiKey = dto.fields.find((f) => f.key === 'apiKey')!;
    expect(apiKey.secret).toBe(true);
    expect(apiKey.isSet).toBe(true);
    expect('value' in apiKey).toBe(false);
  });
});
