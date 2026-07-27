import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BundleLoadError,
  loadModuleBundles,
} from '../../../src/modules/_i18n/services/bundle-loader.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

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
});
