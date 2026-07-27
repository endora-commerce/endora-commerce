import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { resolveEmbedderConfig } from '../../../src/modules/search/services/embedder-config-resolver.js';

/**
 * Feature 058 US1 adoption (T060) — the search LLM embedder config comes SOLELY
 * from the `search.llm.embedder_credentials` reference (Base URL + API key +
 * model). When unset/unresolvable the config is empty (fail closed). Exercises
 * the shared resolver both the indexer event subscriber and the LLM toggle use.
 * [real DB]
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

describe('Search embedder — credential_ref adoption [real DB]', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    channelId = (await h.salesChannels.resolver.getSystemDefault())!.id;
  });
  afterAll(async () => {
    await setSetting(h, 'search.llm.embedder_credentials', '');
    await teardownBackendServer(h);
  });

  it('uses the credential_ref (baseUrl → url, apiKey, model) over legacy fields', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'embedder-llm',
        name: 'Embedder LLM',
        typeCode: 'llm',
        providerCode: 'openai',
        values: {
          apiKey: 'sk-embedder',
          model: 'text-embedding-cred',
          baseUrl: 'https://embed.example.test',
        },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);

    await setSetting(h, 'search.llm.embedder_credentials', 'embedder-llm');

    const cfg = await resolveEmbedderConfig(
      h.settings.settingsService,
      channelId,
      h.credentials.service,
    );
    expect(cfg).toEqual({
      url: 'https://embed.example.test',
      apiKey: 'sk-embedder',
      model: 'text-embedding-cred',
    });

    // With the reference set, LLM search can be enabled without the legacy fields.
    const toggle = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      payload: { enabled: true, expectedVersion: null },
      ...ADMIN,
    });
    expect(toggle.statusCode).toBe(200);
    // Turn it back off so it does not leak into other search suites.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      payload: { enabled: false, expectedVersion: null },
      ...ADMIN,
    });
  });

  it('returns an empty config (fail closed) when no reference is set', async () => {
    await setSetting(h, 'search.llm.embedder_credentials', '');

    const cfg = await resolveEmbedderConfig(
      h.settings.settingsService,
      channelId,
      h.credentials.service,
    );
    expect(cfg).toEqual({ url: '', apiKey: '', model: '' });
  });

  it('returns an empty config when the reference is missing/inert', async () => {
    await setSetting(h, 'search.llm.embedder_credentials', 'does-not-exist');

    const cfg = await resolveEmbedderConfig(
      h.settings.settingsService,
      channelId,
      h.credentials.service,
    );
    expect(cfg).toEqual({ url: '', apiKey: '', model: '' });
  });
});
