import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { searchManifest } from '../../../../packages/modules/search/src/manifest.js';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { SettingGroup } from '@endora-commerce/platform/kernel';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import {
  DEFAULT_INDEX_TASK_TIMEOUT_SECONDS,
  SEARCH_SETTING_CODES,
} from '../../../../packages/modules/search/src/manifest.js';

/**
 * T020 — Manifest reconciliation for the search module (feature 006).
 *
 * Asserts:
 *   - The `search` group exists after boot.
 *   - All declared settings exist with the right defaults + value types.
 *   - The reconciliation is idempotent: re-running it adds no rows.
 *
 * test-server applies the manifest once during setup; this test re-runs
 * the reconciler with a fresh `ManifestReconciler` to verify the
 * idempotency contract.
 */
describe('search manifest reconciliation (T020)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

    // Feature 058 removed the legacy embedder_* settings. The reconciler never
    // deletes, so a persistent (developer) DB may still carry those orphaned
    // rows from an earlier boot — CI's fresh DB never creates them. Drop any
    // `search` setting no longer declared by the manifest so the exact-set and
    // zero-orphan assertions match CI.
    const em = h.em();
    // Feature 073's activation control is a manifest setting like any other,
    // but it is declared as a literal rather than through the codes map (the
    // map is the module's own knobs), so name it explicitly here.
    const validCodes = new Set<string>([...Object.values(SEARCH_SETTING_CODES), 'search.enabled']);
    const group = await em.findOne(SettingGroup, { code: 'search' });
    if (group) {
      const settings = await em.find(Setting, { group });
      for (const s of settings) {
        if (validCodes.has(s.code)) continue;
        await em.nativeDelete(SettingValue, { setting: s });
        await em.nativeDelete(Setting, { id: s.id });
      }
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seeds the search group and its settings on boot', async () => {
    const em = h.em();
    const group = await em.findOne(SettingGroup, { code: 'search' });
    expect(group).not.toBeNull();
    expect(group?.name).toBe('Search');

    const settings = await em.find(Setting, { group });
    const codes = settings.map((s) => s.code).sort();
    expect(codes).toEqual(
      [
        // Feature 058 — the embedder credential reference is the single source
        // of the embedder Base URL / API key / model (legacy embedder_* removed).
        SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS,
        SEARCH_SETTING_CODES.LLM_ENABLED,
        SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH,
        SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT,
        SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
        // The indexer's Meilisearch task wait. It is an operator knob rather
        // than a constant because its right value is a function of the
        // deployment — catalogue size, index throughput, and how much other
        // work shares the Meilisearch instance — and none of those is knowable
        // from this repository.
        SEARCH_SETTING_CODES.INDEX_TASK_TIMEOUT_SECONDS,
        // Feature 073 — the operator's activation control (T123).
        'search.enabled',
      ].sort(),
    );

    const byCode = new Map(settings.map((s) => [s.code, s]));
    expect(byCode.get(SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT)?.valueType).toBe(
      'number',
    );
    expect(byCode.get(SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT)?.defaultValue).toBe(8);
    expect(byCode.get(SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH)?.defaultValue).toBe(
      3,
    );
    expect(byCode.get(SEARCH_SETTING_CODES.LLM_ENABLED)?.valueType).toBe('boolean');
    expect(byCode.get(SEARCH_SETTING_CODES.LLM_ENABLED)?.defaultValue).toBe(false);
    expect(byCode.get(SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS)?.valueType).toBe(
      'credential_ref',
    );
    expect(byCode.get(SEARCH_SETTING_CODES.LLM_EMBEDDER_CREDENTIALS)?.configurationType).toBe('llm');
    expect(byCode.get(SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES)?.valueType).toBe(
      'number',
    );
    expect(byCode.get(SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES)?.defaultValue).toBe(10);
    expect(byCode.get(SEARCH_SETTING_CODES.INDEX_TASK_TIMEOUT_SECONDS)?.valueType).toBe(
      'number',
    );
    // 120 s, and the number that matters is the one it replaced: the
    // `meilisearch` client's own 5000 ms default, which nine of the indexer's
    // twelve waits took by omission.
    expect(byCode.get(SEARCH_SETTING_CODES.INDEX_TASK_TIMEOUT_SECONDS)?.defaultValue).toBe(
      DEFAULT_INDEX_TASK_TIMEOUT_SECONDS,
    );
  });

  it('is idempotent on re-apply', async () => {
    const reconciler = new ManifestReconciler(h.em());
    const r = await reconciler.apply([settingsManifest, searchManifest]);
    const searchModule = r.perModule.find((m) => m.moduleCode === 'search');
    expect(searchModule).toBeDefined();
    expect(searchModule!.addedGroups).toBe(0);
    expect(searchModule!.addedSettings).toBe(0);
    expect(searchModule!.orphanGroups).toEqual([]);
    expect(searchModule!.orphanSettings).toEqual([]);
  });

  // T046 — feature 006 / Phase 6 polish.
  it('reports zero orphan rows for module="search" on every apply', async () => {
    // Manifest drift = a Setting / SettingGroup row in the DB with
    // ownerModule="search" that no longer appears in the live manifest.
    // The reconciler reports drift in `perModule[*].orphanGroups` /
    // `orphanSettings` so ops can investigate. This test asserts that
    // a clean codebase + clean DB never reports drift, no matter how
    // many times the reconciler runs.
    const reconciler = new ManifestReconciler(h.em());
    for (let i = 0; i < 3; i++) {
      const r = await reconciler.apply([settingsManifest, searchManifest]);
      const searchModule = r.perModule.find((m) => m.moduleCode === 'search');
      expect(searchModule, `pass #${i + 1}`).toBeDefined();
      expect(searchModule!.orphanGroups, `pass #${i + 1} groups`).toEqual([]);
      expect(searchModule!.orphanSettings, `pass #${i + 1} settings`).toEqual(
        [],
      );
    }
  });
});
