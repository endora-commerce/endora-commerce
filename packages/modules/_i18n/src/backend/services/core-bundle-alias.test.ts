import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { manifest } from '../../manifest.js';
import { I18nService } from './i18n-service.js';
import { MissingKeyLogger } from './missing-key-logger.js';

/**
 * The `_i18n` → `core` alias, held where the run everybody uses can see it.
 *
 * `_i18n`'s bundle is stored under the module's id and exposed under the
 * synthetic namespace `core`. Error codes are routed by **module id**, so the
 * platform's own codes ask `translate('_i18n', 'errors.<CODE>', …)` while the
 * merged bundle map has a `core` key and no `_i18n` key. One read-side
 * normalisation in `I18nService` joins the two. Without it that call answers
 * the placeholder, and both composition roots turn a placeholder back into the
 * raiser's untranslated English: every platform code loses its sentence in
 * every language, with no error, no log line anybody reads and no envelope
 * difference an English reader can see.
 *
 * The host's `test/integration/_i18n/platform-error-sentences.test.ts` proves
 * the whole path through a real request and stays the authority on what the
 * root does. It needs a database and a booted server, so no service-free run
 * can reach it. This file holds the alias itself at that level, beside the
 * service that owns it: the rows are handed over in the shape the table stores
 * them — keyed `_i18n` — through a stub `EntityManager`, and everything above
 * the stub is the real service. The host's `i18n-service.unit.test.ts` replaces
 * `getMergedBundleForLanguage` outright, which is one of the places the alias
 * is applied, so it cannot see this.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLES_DIR = join(HERE, '..', '..', '..', 'i18n');

type Language = 'en' | 'pl';
type Entries = Readonly<Record<string, string>>;

/** The module's shipped bundle for one language, as its `i18n/` directory holds it. */
function shippedBundle(language: Language): Entries {
  return JSON.parse(readFileSync(join(BUNDLES_DIR, `${language}.json`), 'utf8')) as Entries;
}

interface StoredRow {
  readonly moduleId: string;
  readonly languageCode: Language;
  readonly entries: Entries;
  readonly version: number;
}

/** The real service over rows shaped as `translation_bundles` stores them. */
function serviceOver(rows: readonly StoredRow[]): I18nService {
  const em = {
    execute: async (_sql: string, [language]: readonly string[]) => [
      {
        max: rows
          .filter((row) => row.languageCode === language)
          .reduce((highest, row) => Math.max(highest, row.version), 0),
      },
    ],
    find: async (_entity: unknown, where: { languageCode: Language }) =>
      rows.filter((row) => row.languageCode === where.languageCode),
  };
  return new I18nService({
    em: (() => em) as unknown as ConstructorParameters<typeof I18nService>[0]['em'],
    missingKeyLogger: new MissingKeyLogger({ logger: { info: vi.fn() } }),
  });
}

/** `_i18n`'s two shipped bundles, stored under the module's own id. */
function shippedRows(): StoredRow[] {
  return (['en', 'pl'] as const).map((languageCode) => ({
    moduleId: '_i18n',
    languageCode,
    entries: shippedBundle(languageCode),
    version: 1,
  }));
}

describe('the `_i18n` bundle is exposed as `core` and reachable by the module id', () => {
  /**
   * Written out rather than read from the bundle: an assertion that compares
   * the service's answer with the file the service was just handed would pass
   * on any sentence at all.
   */
  const PL_INTERNAL = 'Wewnętrzny błąd serwera.';

  it('serves the bundle under `core`, and under no second key', async () => {
    const merged = await serviceOver(shippedRows()).getMergedBundleForLanguage('pl');

    expect(Object.keys(merged.bundles)).toEqual(['core']);
    expect(merged.bundles['core']?.['errors.INTERNAL']).toBe(PL_INTERNAL);
  });

  it('resolves a code routed to `_i18n` through the alias', async () => {
    const svc = serviceOver(shippedRows());

    expect(await svc.translate('_i18n', 'errors.INTERNAL', 'pl')).toBe(PL_INTERNAL);
  });

  it('still resolves the namespace the admin asks for', async () => {
    const svc = serviceOver(shippedRows());

    expect(await svc.translate('core', 'errors.INTERNAL', 'pl')).toBe(PL_INTERNAL);
  });

  /**
   * The population the alias stands in front of, derived rather than counted:
   * every code `_i18n`'s manifest declares that has a sentence in its bundle.
   * A code the manifest declares and no bundle translates is another file's
   * subject, so it is skipped here — and the floor below is what stops that
   * skip from emptying the loop.
   */
  it('gives every platform code that has a sentence its sentence, in both languages', async () => {
    const svc = serviceOver(shippedRows());
    const declared = (manifest.errorCodes ?? []).map((entry) => entry.code);
    const missed: string[] = [];
    let resolved = 0;

    for (const language of ['pl', 'en'] as const) {
      const bundle = shippedBundle(language);
      for (const code of declared) {
        const key = `errors.${code}`;
        const sentence = bundle[key];
        if (sentence === undefined) continue;
        const answer = await svc.translate('_i18n', key, language);
        if (answer === sentence && answer !== `_i18n.${key}`) resolved += 1;
        else missed.push(`${language} ${key} -> ${answer}`);
      }
    }

    expect(declared.length, '`_i18n` declares no error code').toBeGreaterThan(0);
    expect(missed, 'a platform code answered the placeholder instead of its sentence').toEqual([]);
    expect(resolved, 'no declared code has a sentence, so nothing was resolved').toBeGreaterThan(0);
  });

  it('answers a miss with the caller’s id, which is what a root compares against', async () => {
    const svc = serviceOver(shippedRows());

    // Not normalised on the way out: both composition roots recognise a miss by
    // comparing the answer with `${moduleId}.${key}` for the id they passed in.
    expect(await svc.translate('_i18n', 'errors.NO_SUCH_CODE', 'pl')).toBe(
      '_i18n.errors.NO_SUCH_CODE',
    );
  });

  it('aliases this one module and no other', async () => {
    const svc = serviceOver([
      { moduleId: 'orders', languageCode: 'en', entries: { 'errors.X': 'Order sentence.' }, version: 1 },
    ]);

    expect(Object.keys((await svc.getMergedBundleForLanguage('en')).bundles)).toEqual(['orders']);
    expect(await svc.translate('orders', 'errors.X', 'en')).toBe('Order sentence.');
    expect(await svc.translate('core', 'errors.X', 'en')).toBe('core.errors.X');
  });
});
