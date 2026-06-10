import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchEventSubscriber } from '../../../src/modules/search/services/search-event-subscriber.js';
import type { SearchIndexer } from '../../../src/modules/search/services/search-indexer.js';
import { SEARCH_SETTING_CODES } from '../../../src/modules/search/manifest.js';

/**
 * T023 — Integration test for the LLM reactor inside SearchEventSubscriber.
 *
 * The reactor subscribes to `settings.value_changed` and reacts when
 * `search.llm.enabled` flips. This test exercises the wiring against the
 * REAL database, settings cache, event bus, and admin route — but
 * substitutes the {@link SearchIndexer} with a recording fake. The
 * integration value is "the reactor reads the right values and asks the
 * indexer to attach/detach against the right channel". Meilisearch's
 * actual `updateEmbedders` round-trip is already proven by
 * `catalog-via-meilisearch.test.ts`.
 */
describe('LLM reactor — settings.value_changed → embedder attach/detach (T023)', () => {
  let h: BackendServerHandle;
  const recorded: Array<
    | { kind: 'attach'; channelCode: string; config: { url: string; apiKey: string; model: string } }
    | { kind: 'detach'; channelCode: string }
  > = [];
  let unsubscribe: (() => void) | null = null;

  beforeAll(async () => {
    // Feature 043: search.llm.embedder_api_key is a `secret` setting now —
    // writing it through the admin API requires the encryption key.
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??
      Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');
    h = await setupBackendServer();

    // Replace the reactor's indexer with a recording fake so the test
    // doesn't depend on Meilisearch task-queue timing. Tear down the
    // real subscriber's wiring first to avoid double-handling.
    h.search.subscriber.teardown();

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
    const replacement = new SearchEventSubscriber({
      eventBus: h.eventBus as never,
      emFactory: h.em,
      indexer: fakeIndexer as SearchIndexer,
      settingsService: h.settings.settingsService,
    });
    unsubscribe = replacement.subscribe();
  }, 60_000);

  afterAll(async () => {
    if (unsubscribe) unsubscribe();
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Reset every search.llm.* setting_value through the admin service
    // so the cache invalidator naturally fires (clears both Redis and
    // the in-process LRU). Going through em.remove directly bypasses
    // SettingsAdminService and would leave stale cache reads behind.
    for (const code of Object.values(SEARCH_SETTING_CODES)) {
      try {
        await h.settings.adminService.resetValues(code, undefined, {
          actorAdminUserId: null,
        });
      } catch {
        // Setting may not have any values yet; ignore.
      }
    }
    // Settle the dispatch chain that resetValues for LLM_ENABLED may
    // have started (reactor → detach), then wipe the recording so each
    // test only observes events caused by its own actions.
    await new Promise((resolve) => setTimeout(resolve, 250));
    recorded.length = 0;
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function populateAllChannels(code: string, value: unknown): Promise<void> {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: adminCookie,
      payload: { scope: 'all', value },
    });
    if (r.statusCode !== 200) {
      throw new Error(`populateAllChannels(${code}) failed: ${r.statusCode}`);
    }
  }

  /**
   * Wait for the event-bus dispatch chain (cache invalidator → reactor)
   * to complete. The bus dispatches via `void` so we cannot await it
   * directly; poll the recording array up to 5 s and bail early if a
   * change is observed.
   */
  async function flushEventBus(): Promise<void> {
    const start = Date.now();
    const initial = recorded.length;
    while (Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (recorded.length !== initial) {
        // Got at least one event — give the chain a final beat to
        // collect any remaining channels from the same emit.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return;
      }
    }
  }

  it('attaches the openAi embedder on enable=true with complete config', async () => {
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'https://emb.example/v1');
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY, 'sk-test');
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL, 'text-embedding-3-small');

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
    // First flip on.
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'https://emb.example/v1');
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY, 'sk-test');
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL, 'text-embedding-3-small');
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/llm/toggle',
      cookies: adminCookie,
      payload: { enabled: true },
    });
    await flushEventBus();
    recorded.length = 0;

    // Now flip off.
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

  it('does NOT attach if any embedder.* field is empty (toggle is refused → no event fires)', async () => {
    // The toggle wrapper refuses to enable when config is incomplete, so
    // no `settings.value_changed` event for `search.llm.enabled` ever
    // fires. Verifies the wrapper's pre-write validator and the
    // reactor's read-time check are belt-and-braces, not redundant.
    await populateAllChannels(SEARCH_SETTING_CODES.LLM_EMBEDDER_URL, 'https://emb.example/v1');
    // api_key + model intentionally not populated.

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
