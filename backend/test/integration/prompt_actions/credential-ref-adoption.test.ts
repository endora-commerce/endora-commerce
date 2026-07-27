import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 058 US1 adoption (T059) — the AI assistant sources its provider /
 * model / API key SOLELY from a `credential_ref` (`prompt_actions.llm_credentials`).
 * When it is not configured (or resolves to an unsupported provider) the
 * assistant fails closed with `not_configured`. [real DB]
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

async function setSetting(h: BackendServerHandle, code: string, value: unknown): Promise<void> {
  const r = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/settings/${code}/value`,
    payload: { scope: 'all', value },
    ...ADMIN,
  });
  if (r.statusCode !== 200) throw new Error(`set ${code} failed: ${r.statusCode} ${r.body}`);
}

describe('Prompt actions — credential_ref adoption [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    await setSetting(h, 'prompt_actions.enabled', true);
  });
  afterAll(async () => {
    // Clear the reference so it does not bleed into other prompt_actions suites.
    await setSetting(h, 'prompt_actions.llm_credentials', '');
    await teardownBackendServer(h);
  });

  it('uses the credential_ref (provider + model + key from the configuration)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'assistant-llm',
        name: 'Assistant LLM',
        typeCode: 'llm',
        providerCode: 'google',
        values: { apiKey: 'sk-assistant', model: 'gemini-cred-model' },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);

    await setSetting(h, 'prompt_actions.llm_credentials', 'assistant-llm');

    const resolved = await h.promptActions.providerFactory.resolve();
    expect(resolved.provider).toBe('google');
    expect(resolved.model).toBe('gemini-cred-model');

    const capability = await h.promptActions.providerFactory.capability();
    expect(capability.status).toBe('ready');
  });

  it('reports not_configured when no credential_ref is set (fail closed)', async () => {
    await setSetting(h, 'prompt_actions.llm_credentials', '');
    expect((await h.promptActions.providerFactory.capability()).status).toBe('not_configured');
    await expect(h.promptActions.providerFactory.resolve()).rejects.toThrow();
  });

  it('reports not_configured when the referenced configuration is missing/inert', async () => {
    await setSetting(h, 'prompt_actions.llm_credentials', 'does-not-exist');
    expect((await h.promptActions.providerFactory.capability()).status).toBe('not_configured');
  });

  it('reports not_configured when the credential resolves to an unsupported provider', async () => {
    // deepseek is a valid `llm` provider but prompt_actions has no adapter for it.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'assistant-deepseek',
        name: 'Assistant DeepSeek',
        typeCode: 'llm',
        providerCode: 'deepseek',
        values: { apiKey: 'sk-deepseek', model: 'deepseek-chat' },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    await setSetting(h, 'prompt_actions.llm_credentials', 'assistant-deepseek');

    expect((await h.promptActions.providerFactory.capability()).status).toBe('not_configured');
  });
});
