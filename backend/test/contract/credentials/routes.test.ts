import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 058 US1 (T019) — admin credentials API contract (contracts/admin-api.md).
 *
 * Request/response shapes, status codes, error envelopes, secret masking, and
 * auth gating over the real routes + composition [real DB].
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'contract-llm';

describe('Credentials admin API [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects an unauthenticated request (401)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /types returns the registered configuration types', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const types = (res.json().types as { code: string; providers: unknown[] }[]).map((t) => t.code);
    expect(types).toContain('llm');
    expect(types).toContain('email_adapter');
  });

  it('POST creates a configuration and masks the secret in the response (201)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'Contract LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-contract', model: 'claude-opus-4-8' },
      },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json() as {
      code: string;
      inert: boolean;
      version: number;
      fields: { key: string; secret: boolean; isSet?: boolean; value?: unknown }[];
    };
    expect(dto.code).toBe(CODE);
    expect(dto.inert).toBe(false);
    const apiKey = dto.fields.find((f) => f.key === 'apiKey')!;
    expect(apiKey.secret).toBe(true);
    expect(apiKey.isSet).toBe(true);
    expect('value' in apiKey).toBe(false);
    expect(res.body).not.toContain('sk-contract');
  });

  it('POST with a duplicate code → 409 CREDENTIAL_CODE_TAKEN', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'dup',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'x', model: 'm' },
      },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CREDENTIAL_CODE_TAKEN');
  });

  it('POST with a missing required field → 422 CREDENTIAL_VALIDATION_FAILED (per-field)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'contract-invalid',
        name: 'Invalid',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { model: 'm' },
      },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CREDENTIAL_VALIDATION_FAILED');
    const details = res.json().error.details as { path: string }[];
    expect(details.some((d) => d.path === 'apiKey')).toBe(true);
  });

  it('POST with an unknown provider → 400 CREDENTIAL_TYPE_UNKNOWN', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'contract-badprovider',
        name: 'Bad',
        typeCode: 'llm',
        providerCode: 'not-a-provider',
        values: { apiKey: 'x', model: 'm' },
      },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CREDENTIAL_TYPE_UNKNOWN');
  });

  it('GET /:code returns the masked configuration; unknown → 404', async () => {
    const ok = await h.app.inject({ method: 'GET', url: `/api/v1/admin/credentials/${CODE}`, ...ADMIN });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { code: string }).code).toBe(CODE);

    const miss = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/nope', ...ADMIN });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error.code).toBe('CREDENTIAL_NOT_FOUND');
  });

  it('PUT rejects a type/provider change → 422 CREDENTIAL_TYPE_IMMUTABLE', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/credentials/${CODE}`,
      payload: { providerCode: 'openai' },
      ...ADMIN,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CREDENTIAL_TYPE_IMMUTABLE');
  });

  it('DELETE removes the configuration → 204, then 404', async () => {
    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/credentials/${CODE}`, ...ADMIN });
    expect(del.statusCode).toBe(204);
    const after = await h.app.inject({ method: 'GET', url: `/api/v1/admin/credentials/${CODE}`, ...ADMIN });
    expect(after.statusCode).toBe(404);
  });
});
