import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BundleLoadError,
  loadModuleBundles,
} from '@endora-commerce/mod-i18n/backend';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Regression guard — every on-disk bundle shipped by a registered module
 * must satisfy `TranslationBundleEntriesSchema` (a FLAT `{"a.b.c": "text"}`
 * object). Nested JSON objects parse fine but fail validation, and the boot
 * reconciler only logs-and-skips such a module (`_i18n/plugin.ts`
 * `reconcileBundles`). The failure is therefore silent: the module's admin
 * pages and its ⌘K action labels render raw translation keys.
 *
 * `bundle-loader.unit.test.ts` covers the loader's error paths against
 * fixtures; this test points the same loader at the real filesystem.
 */
describe('registered module i18n bundles — real filesystem shape', () => {
  const withBundles = REGISTERED_MANIFESTS.filter((e) => e.manifest.i18n);

  it('has at least one module shipping bundles (sanity)', () => {
    expect(withBundles.length).toBeGreaterThan(0);
  });

  it.each(withBundles.map((e) => [e.manifest.id, e] as const))(
    'module "%s" loads without a BundleLoadError',
    (_id, entry) => {
      const bundlesDir = entry.manifest.i18n!.bundlesDir;
      try {
        loadModuleBundles(entry.manifest.id, dirname(entry.filePath), bundlesDir);
      } catch (err) {
        if (err instanceof BundleLoadError) {
          throw new Error(
            `${err.message} (reason: ${err.reason}, file: ${err.path ?? 'n/a'}). ` +
              'Bundle entries must be a flat object of dot-separated key -> string.',
          );
        }
        throw err;
      }
    },
  );

  it('every action label/description key declared in a manifest resolves in both bundles', () => {
    const missing: string[] = [];
    for (const entry of withBundles) {
      const actions = entry.manifest.actions ?? [];
      if (actions.length === 0) continue;
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      for (const [language, entries] of loaded.byLanguage) {
        for (const action of actions) {
          const keys = [action.labelKey, action.descriptionKey].filter(
            (k): k is string => typeof k === 'string',
          );
          for (const key of keys) {
            if (!(key in entries)) {
              missing.push(`${entry.manifest.id}/${language}.json → ${key}`);
            }
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Issue #65 — refusal-token sentences (`errors.<CODE>.<token>`).
   *
   * `check:error-translations` walks the declared codes, so it sees
   * `errors.<CODE>` and nothing below it. A token key is therefore invisible to
   * that ratchet, and a token that ships in one language only degrades quietly:
   * the missing side falls back to the route's written English message instead
   * of rendering a raw code, which is safe enough that nobody would notice.
   * Both directions, so a stray PL sentence with no EN twin fails too.
   */
  it('every refusal-token sentence ships in both languages', () => {
    const tokenKeys = (entries: Record<string, string>): string[] =>
      Object.keys(entries).filter((key) => /^errors\.[A-Z0-9_]+\.[a-z0-9_]+$/.test(key));
    const asymmetric: string[] = [];
    for (const entry of withBundles) {
      const loaded = loadModuleBundles(
        entry.manifest.id,
        dirname(entry.filePath),
        entry.manifest.i18n!.bundlesDir,
      );
      const en = loaded.byLanguage.get('en');
      const pl = loaded.byLanguage.get('pl');
      if (!en || !pl) continue;
      for (const key of tokenKeys(en)) {
        if (!(key in pl)) asymmetric.push(`${entry.manifest.id}/pl.json → ${key}`);
      }
      for (const key of tokenKeys(pl)) {
        if (!(key in en)) asymmetric.push(`${entry.manifest.id}/en.json → ${key}`);
      }
    }
    expect(asymmetric).toEqual([]);
  });

  it('the transact-gate refusal keeps a sentence of its own', () => {
    // Named rather than left to the parity rule above, which passes on zero
    // token keys: deleting both sides of this one would otherwise be silent,
    // and it is what four surfaces show a blocked Organization's buyer.
    const i18n = withBundles.find((e) => e.manifest.id === '_i18n');
    expect(i18n).toBeDefined();
    const loaded = loadModuleBundles(
      '_i18n',
      dirname(i18n!.filePath),
      i18n!.manifest.i18n!.bundlesDir,
    );
    for (const language of ['en', 'pl'] as const) {
      expect(
        loaded.byLanguage.get(language)?.['errors.FORBIDDEN.organization_cannot_transact'],
      ).toBeTypeOf('string');
    }
  });
});
