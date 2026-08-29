import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { SEARCH_SETTING_CODES } from '../../../../packages/modules/search/src/manifest.js';
import { CredentialConfiguration } from '../../helpers/package-entities.js';

/**
 * T023 — Integration test for the LLM reactor inside SearchEventSubscriber.
 *
 * The reactor subscribes to `settings.value_changed` and reacts when
 * `search.llm.enabled` flips. This test exercises the wiring against the
 * REAL database, settings cache, event bus, and admin route — but
 * substitutes the {@link SearchIndexer} with a recording fake. The
 * integration value is "the reactor reads the right values and asks the
 * indexer to attach/detach against the right channel".
 *
 * Feature 058 — the embedder config comes solely from the
 * `search.llm.embedder_credentials` reference (an `llm` credential supplying
 * Base URL + API key + model).
 */
describe('LLM reactor — settings.value_changed → embedder attach/detach (T023)', () => {
  let h: BackendServerHandle;
  const recorded: Array<
    | { kind: 'attach'; channelCode: string; config: { url: string; apiKey: string; model: string } }
    | { kind: 'detach'; channelCode: string }
  > = [];
  let unsubscribe: (() => void) | null = null;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??
      Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');
    h = await setupBackendServer();

    // Replace the reactor's indexer with a recording fake so the test doesn't
    // depend on Meilisearch task-queue timing. The subscription itself belongs
    // to `search/backend.ts` now (issue #107) and is gated there, so the test
    // swaps the indexer *inside* the composed subscriber rather than tearing
    // the wiring down and attaching an ungated copy of it.
    const fakeIndexer: Pick<
      SearchIndexer,
      'attachEmbedderForChannel' | 'detachEmbedderForChannel'
    > = {
      attachEmbedderForChannel: async (channelCode, config) => {
        recorded.push({ kind: 'attach', channelCode, config });
      },
      detachEmbedderForChannel: async (channelCode) => {
        recorded.push({ kind: 'detach', channelCode });
      },
    };
    const deps = (h.search.subscriber as unknown as { deps: { indexer: SearchIndexer } }).deps;
    const realIndexer = deps.indexer;
    deps.indexer = fakeIndexer as SearchIndexer;
    unsubscribe = () => {
      deps.indexer = realIndexer;
    };
  }, 60_000);

  afterAll(async () => {
    if (unsubscribe) unsubscribe();
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Reset every search.llm.* setting_value through the admin service so the
    // cache invalidator naturally fires (clears both Redis and the in-process
    // LRU), and drop any credential configuration left by a prior test.
    for (const code of Object.values(SEARCH_SETTING_CODES)) {
      try {
        await h.settings.adminService.resetValues(code, undefined, {
          actorAdminUserId: null,
        });
      } catch {
        // Setting may not have any values yet; ignore.
      }
    }
    await h.em().nativeDelete(CredentialConfiguration, {});
    // Settle the dispatch chain that resetValues for LLM_ENABLED may have
    // started (reactor → detach), then wipe the recording.
    await new Promise((resolve) => setTimeout(resolve, 250));
    recorded.length = 0;
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function setValue(code: string, value: unknown): Promise<void> {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: adminCookie,
      payload: { scope: 'all', value },
    });
    if (r.statusCode !== 200) throw new Error(`setValue(${code}) failed: ${r.statusCode}`);
  }

  /** Create an `llm` credential and point `embedder_credentials` at it. */
  async function configureEmbedderCredential(values: Record<string, unknown>): Promise<void> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      cookies: adminCookie,
      payload: { code: 'reactor-embedder', name: 'reactor-embedder', typeCode: 'llm', providerCode: 'openai', values },
    });
    if (created.statusCode !== 201) throw new Error(`create config failed: ${created.statusCode} ${created.body}`);
    await setValue(SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS, 'reactor-embedder');
  }

  async function flushEventBus(): Promise<void> {
    const start = Date.now();
    const initial = recorded.length;
    while (Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (recorded.length !== initial) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return;
      }
    }
  }

  it('attaches the openAi embedder on enable=true with a complete credential', async () => {
    await configureEmbedderCredential({
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      baseUrl: 'https://emb.example/v1',
    });

    recorded.length = 0;
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(200);

    await flushEventBus();
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((r) => r.kind === 'attach')).toBe(true);
    const attaches = recorded.filter((r) => r.kind === 'attach') as Array<{
      kind: 'attach';
      channelCode: string;
      config: { url: string; apiKey: string; model: string };
    }>;
    for (const a of attaches) {
      expect(a.config.url).toBe('https://emb.example/v1');
      expect(a.config.apiKey).toBe('sk-test');
      expect(a.config.model).toBe('text-embedding-3-small');
    }
  });

  it('detaches when enable flips back to false', async () => {
    await configureEmbedderCredential({
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
      baseUrl: 'https://emb.example/v1',
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    await flushEventBus();
    recorded.length = 0;

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: false },
    });
    expect(r.statusCode).toBe(200);
    await flushEventBus();

    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.every((r) => r.kind === 'detach')).toBe(true);
  });

  it('does NOT attach if the credential is incomplete (toggle refused → no event fires)', async () => {
    // Credential missing baseUrl → embedder URL missing → toggle refused, so no
    // `settings.value_changed` for `search.llm.enabled` ever fires.
    await configureEmbedderCredential({ apiKey: 'sk-test', model: 'text-embedding-3-small' });

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    expect(r.statusCode).toBe(400);

    await flushEventBus();
    expect(recorded.length).toBe(0);
  });
});
