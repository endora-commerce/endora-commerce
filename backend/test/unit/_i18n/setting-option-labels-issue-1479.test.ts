import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #1479 (UX audit 2026-11-17, SHELL-02) — the Settings screen labels an
 * enum setting's options from the declaring module's bundle,
 * `settingLabels.<setting code>.options.<option value>`
 * (`packages/modules/settings/src/admin/components/setting-label.ts`), and
 * shows the bare value only when the bundle has no label. Before the issue,
 * every option was the machine value — `gross_only`, `gus_mf`, `attachment` —
 * in both languages.
 *
 * Unlike names and descriptions (issue #902, which holds two modules), this
 * holds every registered manifest: there are few enum settings, and a new one
 * without labels is exactly the regression the issue is about. The settings are
 * read from the registered manifests and the bundles off disk beside them, so
 * this file imports no module and stays the repository's
 * (`check:test-ownership`, §1: zero owners).
 */

/**
 * Settings whose stored values *are* the operator's vocabulary, shown as they
 * are on purpose. Each entry says why.
 */
const SHOWN_AS_STORED: Readonly<Record<string, string>> = {
  // The four `robots` directive pairs (`specs/144-seo-search-engine-robots/`):
  // the words an SEO specialist and every crawler's documentation use, in
  // either language, and the ones the setting's description explains.
  'seo.default_robots': 'robots directives are the vocabulary',
};

interface EnumSetting {
  readonly moduleId: string;
  readonly code: string;
  readonly options: readonly string[];
  readonly bundlesDir: string | undefined;
  readonly filePath: string;
}

const enumSettings: EnumSetting[] = REGISTERED_MANIFESTS.flatMap((entry) =>
  (entry.manifest.settings?.settings ?? [])
    .filter((setting) => (setting.enumOptions?.length ?? 0) > 0)
    .map((setting) => ({
      moduleId: entry.manifest.settings?.moduleCode ?? entry.manifest.id,
      code: setting.code,
      options: setting.enumOptions ?? [],
      bundlesDir: entry.manifest.i18n?.bundlesDir,
      filePath: entry.filePath,
    })),
);

function bundle(setting: EnumSetting, language: string): Record<string, string> | null {
  if (setting.bundlesDir === undefined) return null;
  const path = resolve(dirname(setting.filePath), setting.bundlesDir, `${language}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const filled = (value: unknown): boolean => typeof value === 'string' && /\S/.test(value);

describe('enum setting options are labelled in every shipped language (issue #1479)', () => {
  it('finds the enum settings this test is about', () => {
    // Positive control: an empty population would make the case below vacuous.
    expect(enumSettings.length).toBeGreaterThanOrEqual(10);
    expect(enumSettings.map((s) => s.code)).toContain('pricing.default_display_mode');
    // An exemption naming a setting that no longer exists is stale.
    for (const code of Object.keys(SHOWN_AS_STORED)) {
      expect(enumSettings.map((s) => s.code)).toContain(code);
    }
  });

  it.each(SUPPORTED_LANGUAGES)('every option of every enum setting has a label in %s', (language) => {
    const missing: string[] = [];
    for (const setting of enumSettings) {
      if (setting.code in SHOWN_AS_STORED) continue;
      const strings = bundle(setting, language);
      for (const option of setting.options) {
        const key = `settingLabels.${setting.code}.options.${option}`;
        if (!filled(strings?.[key])) missing.push(`${setting.moduleId}/${language}.json → ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
