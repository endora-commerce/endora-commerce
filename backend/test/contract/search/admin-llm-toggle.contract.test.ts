import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SEARCH_SETTING_CODES } from '../../../src/modules/search/manifest.js';

/**
 * T022 — Contract test for `POST /api/v1/admin/search/llm/toggle`.
 *
 *   - enable when all three embedder.* fields populated → 200; toggle row
 *     persisted, response carries the new version + applied channel ids.
 *   - enable when any embedder.* field is empty → 400 LLM_CONFIG_INCOMPLETE;
 *     toggle row NOT persisted.
 *   - disable always succeeds, regardless of embedder.* state.
 *   - non-admin caller → 401 UNAUTHORIZED (test-actor stub returns no actor).
 */
describe('POST /api/v1/admin/search/llm/toggle (T022)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    // Feature 043: search.llm.embedder_api_key is a `secret` setting now —
    // writing it through the admin API requires the encryption key.
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??
      Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Reset every search.llm.* per-channel value AND the global override so
    // each test starts blank. With feature 042 the "all channels" path
    // stores the value in `setting.global_value` rather than fanning out
    // per-channel rows, so the beforeEach has to clear both tiers.
    const em = h.em();
    const codes = Object.values(SEARCH_SETTING_CODES);
    const settings = await em.find(Setting, { code: { $in: codes } });
    for (const s of settings) {
      const values = await em.find(SettingValue, { setting: s });
      for (const v of values) em.remove(v);
      s.globalValue = null;
    }
    await em.flush();
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('refuses enable when no embedder.* fields are set → 400 LLM_CONFIG_INCOMPLETE', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.LLM_CONFIG_INCOMPLETE);
    // Every channel × every embedder.* field is missing — at least 3 entries.
    expect(body.error.details.length).toBeGreaterThanOrEqual(3);

    // Toggle stays at default (false) — no setting_values rows for it.
    const em = h.em();
    const toggle = await em.findOne(Setting, {
      code: SEARCH_SETTING_CODES.LLM_ENABLED,
    });
    expect(toggle).not.toBeNull();
    const values = await em.find(SettingValue, { setting: toggle });
    expect(values).toHaveLength(0);
  });

  it('refuses enable when any single embedder.* field is empty', async () => {
    // Populate two of the three; leave api_key empty.
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'https://emb.example/v1');
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL, 'text-embedding-3-small');
    // api_key intentionally NOT populated.

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.LLM_CONFIG_INCOMPLETE);
    // Every channel reports api_key as missing.
    expect(
      body.error.details.every((d) =>
        d.path.endsWith(SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY),
      ),
    ).toBe(true);
  });

  it('accepts enable when all three embedder.* fields are populated → 200', async () => {
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'https://emb.example/v1');
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY, 'sk-test');
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL, 'text-embedding-3-small');

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
    // No salesChannelCodes parameter ⇒ writes the platform-wide global
    // override (feature 042). `appliedChannelIds` lists per-channel rows
    // touched; for an "all channels" write the new model touches zero
    // rows and instead bumps `setting.global_value`.
    expect(body.appliedChannelIds).toEqual([]);

    // Toggle stored as global override; no per-channel rows are created.
    const em = h.em();
    const toggle = await em.findOneOrFail(Setting, {
      code: SEARCH_SETTING_CODES.LLM_ENABLED,
    });
    expect(toggle.globalValue).toBe(true);
    const values = await em.find(SettingValue, { setting: toggle });
    expect(values).toHaveLength(0);
  });

  it('accepts disable even when no embedder.* fields are set', async () => {
    // First flip on (with valid config) so we have something to disable.
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'https://emb.example/v1');
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY, 'sk-test');
    await populateAllChannels(h, SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL, 'text-embedding-3-small');
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    // Now blank out the embedder fields again.
    const em = h.em();
    const codes = [
      SEARCH_SETTING_CODES.LLM_EMBEDDER_URL,
      SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY,
      SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL,
    ];
    for (const code of codes) {
      const setting = await em.findOne(Setting, { code });
      const values = await em.find(SettingValue, { setting });
      for (const v of values) em.remove(v);
    }
    await em.flush();

    // Disabling MUST still succeed.
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  it('rejects an unauthenticated caller with 401 UNAUTHORIZED', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      // No admin cookie.
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(401);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});

/**
 * Helper: write `value` to every channel in scope for the given setting,
 * via the generic Settings admin route. Mirrors what the admin UI does
 * when the operator types into the embedder.* fields.
 */
async function populateAllChannels(
  h: BackendServerHandle,
  settingCode: string,
  value: unknown,
): Promise<void> {
  const r = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/settings/${settingCode}/value`,
    cookies: { b2b_session: 'stub-admin-session' },
    payload: { scope: 'all', value },
  });
  if (r.statusCode !== 200) {
    throw new Error(
      `populateAllChannels(${settingCode}) failed: ${r.statusCode} ${r.body}`,
    );
  }
}
