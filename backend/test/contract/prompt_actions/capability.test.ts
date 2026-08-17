import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ScriptedLlm, seedPromptActionsSettings } from '../../helpers/prompt-actions.js';

/**
 * T054 — US4 governance: capability states (disabled / not_configured /
 * ready), submit guards, live settings pickup without restart (US4/AC4),
 * and permission gating.
 */

const adminCookie = { b2b_session: 'stub-admin-session' };
const restrictedCookie = { b2b_session: 'stub-restricted-admin-session' };

describe('US4 — capability and governance (T054)', () => {
  let h: BackendServerHandle;
  const llm = new ScriptedLlm();

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    h = await setupBackendServer({ promptActionsLlmFetch: llm.fetch });
  });

  afterAll(async () => {
    // Leave the platform configured for any later suites.
    await seedPromptActionsSettings(h);
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  async function capability(): Promise<{ status: string; bulkLimit: number }> {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/prompt-actions/capability',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    return (r.json() as { data: { status: string; bulkLimit: number } }).data;
  }

  async function submitStatus(): Promise<{ statusCode: number; code: string | undefined }> {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/prompt-actions/requests',
      cookies: adminCookie,
      payload: { prompt: 'anything' },
    });
    return {
      statusCode: r.statusCode,
      code: (r.json() as { error?: { code?: string } }).error?.code,
    };
  }

  it('disabled platform rejects use (US4/AC1): capability=disabled, submit ASSISTANT_DISABLED', async () => {
    // Settings persist across suite files (shared DB, never reset by the
    // reconciler) — set the kill switch explicitly. The manifest default is
    // `false` either way (research §R4).
    await seedPromptActionsSettings(h, { enabled: false });
    expect((await capability()).status).toBe('disabled');
    const submit = await submitStatus();
    expect(submit.statusCode).toBe(409);
    expect(submit.code).toBe(ERROR_CODES.ASSISTANT_DISABLED);
  });

  it('enabled without a key reports not_configured (US4/AC2) and submit is rejected', async () => {
    await seedPromptActionsSettings(h, { enabled: true, apiKey: '' });
    expect((await capability()).status).toBe('not_configured');
    const submit = await submitStatus();
    expect(submit.statusCode).toBe(409);
    expect(submit.code).toBe(ERROR_CODES.ASSISTANT_NOT_CONFIGURED);
  });

  it('an unknown provider value also reports not_configured', async () => {
    await seedPromptActionsSettings(h, { enabled: true, provider: 'skynet' });
    expect((await capability()).status).toBe('not_configured');
  });

  it('configuration changes take effect without a restart (US4/AC4)', async () => {
    await seedPromptActionsSettings(h, { enabled: true, bulkLimit: 42 });
    expect(await capability()).toEqual({ status: 'ready', bulkLimit: 42 });

    await seedPromptActionsSettings(h, { enabled: false, bulkLimit: 42 });
    expect((await capability()).status).toBe('disabled');

    await seedPromptActionsSettings(h, { enabled: true, bulkLimit: 500 });
    expect((await capability()).status).toBe('ready');
  });

  it('operators without prompt_actions:use get 403 regardless of configuration (US4/AC3)', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/prompt-actions/capability',
      cookies: restrictedCookie,
    });
    expect(r.statusCode).toBe(403);
  });

  it('the prompt-actions endpoints are exposed in the OpenAPI document (T060)', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json' });
    expect(r.statusCode).toBe(200);
    const paths = Object.keys((r.json() as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain('/api/v1/admin/prompt-actions/capability');
    expect(paths).toContain('/api/v1/admin/prompt-actions/requests');
    expect(paths.some((p) => p.includes('/admin/prompt-actions/requests/{id}/confirm'))).toBe(
      true,
    );
  });

  it('the capability payload never carries the API key (FR-021 surface check)', async () => {
    await seedPromptActionsSettings(h, { apiKey: 'sk-super-secret-key-xyz' });
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/prompt-actions/capability',
      cookies: adminCookie,
    });
    expect(r.body).not.toContain('sk-super-secret-key-xyz');
    expect(Object.keys((r.json() as { data: Record<string, unknown> }).data).sort()).toEqual([
      'bulkLimit',
      'status',
    ]);
  });
});
