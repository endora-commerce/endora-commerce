import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { I18nService } from '../../../src/modules/_i18n/services/i18n-service.js';
import { MissingKeyLogger } from '../../../src/modules/_i18n/services/missing-key-logger.js';
import { TranslationBundle } from '../../../src/modules/_i18n/entities/translation-bundle.entity.js';

/**
 * T053/T054 (test-side closure) — `translate()` end-to-end against real
 * `translation_bundles` rows. Verifies the full chain runs through one
 * service instance without mocks:
 *
 *   - translate(...) → getMergedBundleForLanguage(...) → SQL MAX(version)
 *     check → in-process cache miss → SELECT rows → merge → resolver →
 *     interpolation → return.
 *   - missing-key path → fallback to EN → MissingKeyLogger emits one
 *     structured `i18n.fallback` line.
 *   - missing-from-both path → placeholder + one log line.
 *
 * The production-side adoption of `translate()` (e.g. translating
 * validation error messages emitted by the settings admin service)
 * is Pass B work — no v1 FR currently requires it. This test closes
 * the test side so the resolver is provably exercised against real DB
 * data, not just stubbed bundles.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_MODULE_PATH = resolve(
  here,
  '../../fixtures/_i18n_integration/demo_module',
);
const MODULE_ID = 'demo_module_translate_test';

describe('I18nService.translate (end-to-end against real DB)', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let logSink: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    orm = await MikroORM.init(await mikroOrmConfig());
  }, 60_000);

  beforeEach(async () => {
    em = orm.em.fork() as EntityManager;
    logSink = vi.fn();
    await em.nativeDelete(TranslationBundle, { moduleId: MODULE_ID });
  });

  afterEach(async () => {
    await em.nativeDelete(TranslationBundle, { moduleId: MODULE_ID });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  function freshService(): I18nService {
    return new I18nService({
      em: () => em,
      missingKeyLogger: new MissingKeyLogger({ logger: { info: logSink } }),
    });
  }

  it('returns the requested-language entry when present in the DB', async () => {
    const i18n = freshService();
    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    em.clear();

    const value = await i18n.translate(MODULE_ID, 'actions.save', 'pl', {}, em);
    expect(value).toBe('Zapisz');
    expect(logSink).not.toHaveBeenCalled();
  });

  it('falls back to EN when the requested-language entry is missing — emits one log line', async () => {
    const i18n = freshService();
    // Install only the EN bundle (delete the pl row to simulate
    // a translation in progress). Easiest path: install both, then
    // delete the pl row directly.
    await i18n.installBundlesForModule(
      MODULE_ID,
      FIXTURE_MODULE_PATH,
      'i18n',
      em,
    );
    await em.nativeDelete(TranslationBundle, {
      moduleId: MODULE_ID,
      languageCode: 'pl',
    });
    em.clear();

    const value = await i18n.translate(MODULE_ID, 'actions.save', 'pl', {}, em);
    expect(value).toBe('Save');
    expect(logSink).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSink.mock.calls[0]![0] as string);
    expect(payload.fellBackTo).toBe('en');
    expect(payload.languageCode).toBe('pl');
    expect(payload.moduleId).toBe(MODULE_ID);
  });

  it('returns the placeholder when both languages are missing — emits one log line', async () => {
    const i18n = freshService();
    // Don't install any bundle; the moduleId has no rows at all.
    const value = await i18n.translate(
      MODULE_ID,
      'actions.unknown',
      'pl',
      {},
      em,
    );
    expect(value).toBe(`${MODULE_ID}.actions.unknown`);
    expect(logSink).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSink.mock.calls[0]![0] as string);
    expect(payload.fellBackTo).toBe('placeholder');
  });

  it('interpolates {name} placeholders against real bundle rows', async () => {
    const i18n = freshService();
    // Replace the en entry with one that has a placeholder, by hand,
    // so we don't depend on the fixture file shape for this specific test.
    await em.getKnex().raw(
      `insert into "translation_bundles" ("module_id", "language_code", "entries", "installed_at", "updated_at") ` +
        `values (?, ?, ?::jsonb, now(), now()) ` +
        `on conflict ("module_id", "language_code") do update set ` +
        `"entries" = excluded."entries", ` +
        `"version" = nextval('translation_bundles_version_seq'), ` +
        `"updated_at" = now()`,
      [MODULE_ID, 'pl', JSON.stringify({ 'toast.created': 'Utworzono {name}' })],
    );
    em.clear();

    const value = await i18n.translate(
      MODULE_ID,
      'toast.created',
      'pl',
      { name: 'demo' },
      em,
    );
    expect(value).toBe('Utworzono demo');
  });
});
