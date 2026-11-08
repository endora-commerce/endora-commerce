import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #902 — the Settings screen reads a setting's name and description from
 * the declaring module's bundle, `settingLabels.<setting code>.name` and
 * `settingLabels.<setting code>.description`
 * (`packages/modules/settings/src/admin/components/setting-label.ts`), and
 * falls back to the English strings the manifest declared. `admin_notifications`
 * and `shipments` shipped no bundle at all, so a Polish operator read both
 * modules' settings in English.
 *
 * Most modules still ship no `settingLabels.*` (measured 2026-11-07), so this is
 * not a repository-wide rule: it holds the two modules the issue names. The
 * settings are read from the registered manifests and the bundles off disk
 * beside them, so this file imports no module and stays the repository's
 * (`check:test-ownership`, §1: zero owners).
 */

const MODULES = ['admin_notifications', 'shipments'] as const;

const entries = REGISTERED_MANIFESTS.filter((entry) =>
  (MODULES as readonly string[]).includes(entry.manifest.id),
);

function bundle(moduleId: string, language: string): Record<string, string> | null {
  const entry = entries.find((e) => e.manifest.id === moduleId);
  const dir = entry?.manifest.i18n?.bundlesDir;
  if (!entry || dir === undefined) return null;
  const path = resolve(dirname(entry.filePath), dir, `${language}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const filled = (value: unknown): boolean => typeof value === 'string' && /\S/.test(value);

describe('setting names and descriptions in every shipped language (issue #902)', () => {
  it('finds the modules and the settings this test is about', () => {
    // Positive control: an empty population would make the cases below vacuous.
    expect(entries.map((e) => e.manifest.id).sort()).toEqual([...MODULES]);
    for (const entry of entries) {
      expect(entry.manifest.settings?.settings.length ?? 0).toBeGreaterThan(0);
    }
  });

  it.each(SUPPORTED_LANGUAGES)('every declared setting has a name and a description in %s', (language) => {
    const missing: string[] = [];
    for (const entry of entries) {
      const strings = bundle(entry.manifest.id, language);
      for (const setting of entry.manifest.settings?.settings ?? []) {
        for (const part of ['name', 'description'] as const) {
          const key = `settingLabels.${setting.code}.${part}`;
          if (!filled(strings?.[key])) missing.push(`${entry.manifest.id}/${language}.json → ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
