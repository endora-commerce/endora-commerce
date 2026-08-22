import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { I18nService } from '../../../src/modules/_i18n/services/i18n-service.js';
import { TranslationBundle } from '../../../src/modules/_i18n/entities/translation-bundle.entity.js';

/**
 * T034–T037 / SC-003 / FR-011 — bundle install / soft-uninstall /
 * hard-uninstall semantics, exercised end-to-end against a real
 * Postgres + a real fixture filesystem.
 *
 * The orchestrator integration is plumbing — when `manifest.i18n` is
 * declared, it dispatches to `i18nReconciler.install()` /
 * `i18nReconciler.remove()`. This test verifies the reconciler's
 * actual SQL behaviour: rows appear, version vector advances,
 * idempotent re-install preserves entries (and bumps version), hard
 * removal drops them. Soft-uninstall is documented as a no-op in the
 * reconciler — `remove()` is only called for hard.
 *
 * Tests do NOT use the begin/rollback fixture pattern: they isolate per test
 * with a unique `moduleId` and explicit row cleanup in before/after hooks.
 * (Until issue #200 they could not have used it — the single-statement UPSERT
 * ran through `em.getKnex().raw(...)` and ignored the transaction entirely;
 * the last test in this file is what holds that fixed.)
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_MODULE_PATH = resolve(
  here,
  '../../fixtures/_i18n_integration/demo_module',
);
const MODULE_ID = 'demo_module_i18n_test';

describe('i18n bundle reconciler (integration)', () => {
  let orm: MikroORM;
  let em: EntityManager;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
    em = orm.em.fork() as EntityManager;
  }, 60_000);

  beforeEach(async () => {
    em = orm.em.fork() as EntityManager;
    await em.nativeDelete(TranslationBundle, { moduleId: MODULE_ID });
  });

  afterEach(async () => {
    await em.nativeDelete(TranslationBundle, { moduleId: MODULE_ID });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  function service(): I18nService {
    return new I18nService({ em: () => em });
  }

  it('installBundlesForModule writes one row per language with the parsed entries', async () => {
    const i18n = service();
    const result = await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    expect(result.installed.sort()).toEqual(['en', 'pl']);

    const rows = await em.find(TranslationBundle, { moduleId: MODULE_ID });
    expect(rows.length).toBe(2);

    const en = rows.find((r) => r.languageCode === 'en');
    const pl = rows.find((r) => r.languageCode === 'pl');
    expect(en?.entries['actions.save']).toBe('Save');
    expect(pl?.entries['actions.save']).toBe('Zapisz');
  });

  it('re-install (idempotent) preserves entries and advances the version vector', async () => {
    const i18n = service();
    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    const firstRows = await em.find(TranslationBundle, { moduleId: MODULE_ID });
    const firstMaxVersion = Math.max(...firstRows.map((r) => Number(r.version)));

    // Re-install — same bundle file, second pass.
    em.clear();
    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    const secondRows = await em.find(TranslationBundle, { moduleId: MODULE_ID });
    expect(secondRows.length).toBe(2);
    const secondMaxVersion = Math.max(
      ...secondRows.map((r) => Number(r.version)),
    );
    // Each conflict-update bumps the sequence, so the second run's max
    // version MUST be strictly greater than the first run's.
    expect(secondMaxVersion).toBeGreaterThan(firstMaxVersion);
  });

  it('removeBundlesForModule deletes every row owned by the module (hard-uninstall)', async () => {
    const i18n = service();
    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    const rowsBefore = await em.find(TranslationBundle, { moduleId: MODULE_ID });
    expect(rowsBefore.length).toBe(2);

    const removed = await i18n.removeBundlesForModule(MODULE_ID, em);
    expect(removed.removed).toBe(2);

    em.clear();
    const rowsAfter = await em.find(TranslationBundle, { moduleId: MODULE_ID });
    expect(rowsAfter.length).toBe(0);
  });

  it('soft-uninstall is a no-op (the reconciler does NOT touch the rows)', async () => {
    // Soft-uninstall preserves the rows by NOT calling
    // `removeBundlesForModule`. We simulate the soft-uninstall path
    // simply by NOT calling remove() and asserting rows are still
    // there — this matches data-model.md §3.
    const i18n = service();
    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    // (no remove call here — soft path)
    em.clear();
    const rows = await em.find(TranslationBundle, { moduleId: MODULE_ID });
    expect(rows.length).toBe(2);
  });

  it('a fresh getMergedBundleForLanguage returns the installed entries (cache invalidates on install)', async () => {
    const i18n = service();
    // Cold cache, no rows yet — should return empty bundles for the module.
    const before = await i18n.getMergedBundleForLanguage('pl', em);
    expect(before.bundles[MODULE_ID]).toBeUndefined();

    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    em.clear();
    const after = await i18n.getMergedBundleForLanguage('pl', em);
    expect(after.bundles[MODULE_ID]?.['actions.save']).toBe('Zapisz');
    expect(after.version).toBeGreaterThan(before.version);
  });

  /**
   * Issue #200 — `installBundlesForModule` takes an `em`, so a caller may hand
   * it a transactional one, and the orchestrator's install path documents the
   * bundle write as part of the install it can revert. The UPSERT ran through
   * `em.getKnex().raw(...)`, which carries no transaction context: the rows
   * committed on their own connection and survived the rollback, while
   * `removeBundlesForModule` next door (an `em.nativeDelete`) did not.
   */
  it('rolls the bundle UPSERT back with the transaction it was handed', async () => {
    const tx = orm.em.fork() as EntityManager;
    await expect(
      tx.transactional(async (txEm) => {
        await service().installBundlesForModule(
          MODULE_ID,
          FIXTURE_MODULE_PATH,
          'i18n',
          txEm,
        );
        throw new Error('roll this back');
      }),
    ).rejects.toThrow('roll this back');

    const fresh = orm.em.fork() as EntityManager;
    const rows = await fresh.find(TranslationBundle, { moduleId: MODULE_ID });
    expect(rows.length).toBe(0);
  });
});
