import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1321 — `OrganizationDetail.tsx` looked up two keys that no catalogue
 * carried, so the admin rendered `core.organizations.detail.…` as the field's
 * label in both languages for months, and nothing reported it.
 *
 * This reads every `useTranslation('<scope>')` binding in the organizations
 * module's admin sources and every call of that binding with a literal key,
 * and holds each key against the scope's English **and** Polish catalogue. A
 * key built from a template (`status.${code}`) is not a literal and is held by
 * the render tests instead (`organization-detail-labels.test.tsx`).
 */

const MODULE_ROOT = resolve(process.cwd(), '../packages/modules/organizations');
const ADMIN_ROOT = join(MODULE_ROOT, 'src/admin');

/** Where a scope's catalogue lives: the module's own, and the shared `core` one. */
const CATALOGUE_DIRS: Record<string, string> = {
  organizations: join(MODULE_ROOT, 'i18n'),
  core: resolve(process.cwd(), '../packages/modules/_i18n/i18n'),
};
const LANGUAGES = ['en', 'pl'] as const;

function catalogue(scope: string, language: string): Record<string, string> {
  const dir = CATALOGUE_DIRS[scope];
  if (!dir) throw new Error(`no catalogue known for scope "${scope}"`);
  return JSON.parse(readFileSync(join(dir, `${language}.json`), 'utf8')) as Record<string, string>;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

interface KeyUse {
  file: string;
  scope: string;
  key: string;
}

/** Each literal key call, attributed to the binding of that name declared nearest above it. */
function keyUses(file: string): KeyUse[] {
  const text = readFileSync(file, 'utf8');
  const bindings: { name: string; scope: string; at: number }[] = [];
  for (const m of text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*useTranslation\(\s*'([^']+)'\s*\)/g)) {
    bindings.push({ name: m[1]!, scope: m[2]!, at: m.index });
  }
  const uses: KeyUse[] = [];
  for (const { name } of new Map(bindings.map((b) => [b.name, b])).values()) {
    const call = new RegExp(`(?<![\\w.])${name}\\(\\s*(?:'([^']+)'|\`([^\`$]+)\`)`, 'g');
    for (const m of text.matchAll(call)) {
      const owner = bindings.filter((b) => b.name === name && b.at < m.index).at(-1);
      if (!owner) continue;
      uses.push({ file: relative(MODULE_ROOT, file), scope: owner.scope, key: (m[1] ?? m[2])! });
    }
  }
  return uses;
}

const USES = sources(ADMIN_ROOT).flatMap(keyUses);

describe('organizations admin — every literal catalogue key resolves (issue #1321)', () => {
  it('finds the key uses it judges', () => {
    // A walk that reads nothing would pass every case below.
    expect(USES.length).toBeGreaterThan(100);
    expect(USES.some((u) => u.file.endsWith('OrganizationDetail.tsx'))).toBe(true);
  });

  it.each(LANGUAGES)('every key is in the %s catalogue of its scope', (language) => {
    const missing = USES.filter((u) => !(u.key in catalogue(u.scope, language))).map(
      (u) => `${u.file}: ${u.scope}.${u.key}`,
    );
    expect([...new Set(missing)]).toEqual([]);
  });
});
