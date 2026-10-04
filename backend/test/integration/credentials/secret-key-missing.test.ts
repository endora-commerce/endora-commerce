import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CredentialConfiguration } from '../../helpers/package-entities.js';

/**
 * Saving a credential on an instance started without
 * `SETTINGS_SECRET_ENCRYPTION_KEY`, over the real admin route.
 *
 * The write must fail closed — it always did — and it must say why. The answer
 * used to be `500 INTERNAL` "Internal server error.", which names neither the
 * variable nor the fix, on the one screen where a first deployment is most
 * likely to meet it.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'no-key-llm';

describe('Credentials — no secret encryption key [real DB]', () => {
  let h: BackendServerHandle;
  let originalKey: string | undefined;

  beforeAll(async () => {
    // The module reads the key when its service is constructed, so it has to be
    // absent before the server is composed.
    originalKey = process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    if (originalKey !== undefined) process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = originalKey;
  });

  it('answers 500 SETTING_SECRET_KEY_MISSING naming the variable, and stores nothing', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'No key',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-must-not-be-stored', model: 'claude-opus-4-8' },
      },
      ...ADMIN,
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe(ERROR_CODES.SETTING_SECRET_KEY_MISSING);
    expect(body.error.message).toContain('SETTINGS_SECRET_ENCRYPTION_KEY');
    expect(body.error.requestId).toBeTruthy();
    // The secret itself is never echoed back.
    expect(res.body).not.toContain('sk-must-not-be-stored');

    // Fail-closed: no row, encrypted or otherwise.
    expect(await h.em().findOne(CredentialConfiguration, { code: CODE })).toBeNull();
  });
});
