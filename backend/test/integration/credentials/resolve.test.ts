import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CredentialConfiguration } from '../../helpers/package-entities.js';

/**
 * Feature 058 US2 (T036) — CredentialsService.resolve(code) [real DB].
 *
 * ok (secrets DECRYPTED in-memory) / not_configured (unset) / unavailable
 * (deleted code or inert unregistered type). Never a foreign config.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('Credentials resolve [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves ok with the secret decrypted in-memory', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'resolve-llm',
        name: 'Resolve LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-resolve', model: 'claude-opus-4-8' },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);

    const result = await h.credentials.service.resolve('resolve-llm');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.typeCode).toBe('llm');
      expect(result.providerCode).toBe('anthropic');
      // Secret is decrypted for consumer use.
      expect(result.values['apiKey']).toBe('sk-resolve');
      expect(result.values['model']).toBe('claude-opus-4-8');
    }
  });

  it('returns not_configured for an empty reference', async () => {
    const result = await h.credentials.service.resolve('');
    expect(result.status).toBe('not_configured');
  });

  it('returns unavailable/missing for a deleted or unknown code', async () => {
    const result = await h.credentials.service.resolve('does-not-exist');
    expect(result).toEqual({ status: 'unavailable', reason: 'missing' });
  });

  it('returns unavailable/inert_type when the stored typeCode is unregistered', async () => {
    // Insert a configuration whose type is not in the registry (simulates a
    // removed module / orphaned type) — cannot be created via the API.
    const em = h.em();
    const ghost = em.create(CredentialConfiguration, {
      code: 'ghost-config',
      name: 'Ghost',
      typeCode: 'ghost_type',
      providerCode: 'x',
      values: {},
    });
    await em.persistAndFlush(ghost);

    const result = await h.credentials.service.resolve('ghost-config');
    expect(result).toEqual({ status: 'unavailable', reason: 'inert_type' });
  });
});
