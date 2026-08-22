import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { CredentialConfiguration } from '../../../src/modules/credentials/entities/credential-configuration.entity.js';
import { SEARCH_SETTING_CODES } from '../../../src/modules/search/manifest.js';

/**
 * T022 — Contract test for `POST /api/v1/admin/search/llm/toggle`.
 *
 * Feature 058 — the embedder config comes solely from the
 * `search.llm.embedder_credentials` reference (an `llm` credential supplying
 * Base URL + API key + model):
 *
 *   - enable when the referenced credential is complete → 200; toggle row
 *     persisted, response carries the new version + applied channel ids.
 *   - enable when no reference is set → 400 LLM_CONFIG_INCOMPLETE (not persisted).
 *   - enable when the reference omits a field (e.g. Base URL) → 400.
 *   - disable always succeeds, regardless of embedder state.
 *   - non-admin caller → 401 UNAUTHORIZED.
 */
describe('POST /api/v1/admin/search/llm/toggle (T022)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??
      Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Reset every search.llm.* value (global + per-channel) so each test starts
    // blank, and drop any credential configuration left by a prior test.
    const em = h.em();
    const codes = Object.values(SEARCH_SETTING_CODES);
    const settings = await em.find(Setting, { code: { $in: codes } });
    for (const s of settings) {
      const values = await em.find(SettingValue, { setting: s });
      for (const v of values) em.remove(v);
      s.globalValue = null;
    }
    await em.flush();
    await em.nativeDelete(CredentialConfiguration, {});
  });

  async function setEmbedderCredential(code: string): Promise<void> {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS}/value`,
      cookies: adminCookie,
      payload: { scope: 'all', value: code },
    });
    if (r.statusCode !== 200) throw new Error(`set embedder credential failed: ${r.statusCode} ${r.body}`);
  }

  async function createLlmConfig(
    code: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      cookies: adminCookie,
      payload: { code, name: code, typeCode: 'llm', providerCode: 'openai', values },
    });
    if (r.statusCode !== 201) throw new Error(`create llm config failed: ${r.statusCode} ${r.body}`);
  }

  it('refuses enable when no embedder credential is referenced → 400 LLM_CONFIG_INCOMPLETE', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.LLM_CONFIG_INCOMPLETE);
    // Every channel × every embedder field (url/apiKey/model) is missing.
    expect(body.error.details.length).toBeGreaterThanOrEqual(3);
    expect(
      body.error.details.every((d) => d.path.endsWith(SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS)),
    ).toBe(true);

    // Toggle stays at default (false) — no setting_values rows for it.
    const em = h.em();
    const toggle = await em.findOne(Setting, { code: SEARCH_SETTING_CODES.LLM_ENABLED });
    expect(toggle).not.toBeNull();
    expect(await em.find(SettingValue, { setting: toggle })).toHaveLength(0);
  });

  it('refuses enable when the referenced credential omits a field (Base URL)', async () => {
    // apiKey + model present, but no baseUrl → embedder URL missing.
    await createLlmConfig('embedder-no-url', { apiKey: 'sk-test', model: 'text-embedding-3-small' });
    await setEmbedderCredential('embedder-no-url');

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.LLM_CONFIG_INCOMPLETE);
    expect(body.error.details.every((d) => d.issue.includes('url'))).toBe(true);
  });

  it('accepts enable when the referenced credential supplies url + key + model → 200', async () => {
    await createLlmConfig('embedder-complete', {
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      baseUrl: 'https://emb.example/v1',
    });
    await setEmbedderCredential('embedder-complete');

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      code: string;
      enabled: boolean;
      newVersion: string;
      appliedChannelIds: string[];
    };
    expect(body.code).toBe('search.llm.enabled');
    expect(body.enabled).toBe(true);
    expect(body.newVersion).toBeTruthy();
    // "All channels" write bumps the global override; no per-channel rows.
    expect(body.appliedChannelIds).toEqual([]);

    const em = h.em();
    const toggle = await em.findOneOrFail(Setting, { code: SEARCH_SETTING_CODES.LLM_ENABLED });
    expect(toggle.globalValue).toBe(true);
    expect(await em.find(SettingValue, { setting: toggle })).toHaveLength(0);
  });

  it('accepts disable even when no embedder credential is set', async () => {
    // Flip on with a valid credential, then remove it and disable.
    await createLlmConfig('embedder-toggle', {
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      baseUrl: 'https://emb.example/v1',
    });
    await setEmbedderCredential('embedder-toggle');
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    await setEmbedderCredential('');

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { enabled: boolean }).enabled).toBe(false);
  });

  it('rejects an unauthenticated caller with 401 UNAUTHORIZED', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(401);
    expect((r.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});
