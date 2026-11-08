import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #884 — the Settings screen reads a group's heading from the declaring
 * module's bundle, `settingGroups.<group code>.name`
 * (`packages/modules/settings/src/admin/components/setting-label.ts`), and
 * falls back to the English name the manifest declared. Issue #476 repaired
 * the `settings` module's own three groups and guarded that one module; about
 * 45 other modules declared groups with no key, so a Polish operator read
 * their headings in English.
 *
 * The population is every registered manifest's `settings.groups`, so a group
 * added tomorrow is held to the rule the day it is declared. The bundle is
 * read off disk beside the manifest rather than through a module's loader, so
 * this file names no module and stays the repository's
 * (`check:test-ownership`, §1: zero owners).
 */

interface DeclaringModule {
  readonly id: string;
  readonly groups: readonly string[];
  readonly bundlesDir: string | null;
}

const declaring: DeclaringModule[] = REGISTERED_MANIFESTS.flatMap((entry) => {
  const groups = (entry.manifest.settings?.groups ?? []).map((g) => g.code);
  if (groups.length === 0) return [];
  const dir = entry.manifest.i18n?.bundlesDir;
  return [
    {
      id: entry.manifest.id,
      groups,
      bundlesDir: dir === undefined ? null : resolve(dirname(entry.filePath), dir),
    },
  ];
});

function bundle(module: DeclaringModule, language: string): Record<string, string> | null {
  if (module.bundlesDir === null) return null;
  const path = resolve(module.bundlesDir, `${language}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

describe('settings group names in every shipped language (issue #884)', () => {
  it('finds the modules this test is about', () => {
    // Positive control: an empty population would make the cases below vacuous.
    expect(declaring.map((m) => m.id)).toEqual(
      expect.arrayContaining(['settings', 'orders', 'mfa', 'carts', 'cms']),
    );
  });

  it.each(SUPPORTED_LANGUAGES)('every declared group has a name key in %s', (language) => {
    const missing: string[] = [];
    for (const module of declaring) {
      const entries = bundle(module, language);
      for (const code of module.groups) {
        const value = entries?.[`settingGroups.${code}.name`];
        if (typeof value !== 'string' || !/\S/.test(value)) {
          missing.push(`${module.id}/${language}.json → settingGroups.${code}.name`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
