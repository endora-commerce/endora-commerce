/**
 * The release index — D-271 clause 2 (`specs/080-f4-real-scope/rulings.md`).
 *
 * The CLI's build writes `dist/release-index.json`: every workspace package
 * under `packages/` whose manifest is not `private` and whose name is in the
 * CLI's own scope, each at the `version` its manifest declares. It is derived
 * at build time and never committed, and the derivation is **one** rule shared
 * with the instance acceptance criterion's `publishablePackages()` rather than
 * restated there.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parseReleaseIndex,
  publishablePackages,
  releaseIndexOf,
  RELEASE_INDEX_FILE,
} from '../src/lib/release-index.js';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = dirname(dirname(PACKAGE_ROOT));
const PACKAGES_ROOT = join(REPOSITORY_ROOT, 'packages');
const SCOPE = '@endora-commerce/';

/** Every manifest under `packages/`, walked independently of the code under test. */
function everyManifest(): readonly { dir: string; manifest: Record<string, unknown> }[] {
  const found: { dir: string; manifest: Record<string, unknown> }[] = [];
  const walk = (root: string): void => {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const dir = join(root, entry.name);
      const path = join(dir, 'package.json');
      if (existsSync(path)) {
        found.push({ dir, manifest: JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> });
      } else {
        walk(dir);
      }
    }
  };
  walk(PACKAGES_ROOT);
  return found;
}

describe('the derivation', () => {
  const index = releaseIndexOf(PACKAGES_ROOT, SCOPE);
  const names = index.packages.map((entry) => entry.name);

  it('includes the platform, the admin shell, the admin kit and every module package', () => {
    for (const name of ['platform', 'admin-shell', 'admin-kit', 'cli']) {
      expect(names, `${SCOPE}${name} is missing from the index`).toContain(`${SCOPE}${name}`);
    }
    const modules = everyManifest()
      .filter(({ manifest }) => (manifest['endora'] as { type?: unknown } | undefined)?.type === 'module')
      .filter(({ manifest }) => manifest['private'] !== true)
      .map(({ manifest }) => manifest['name'] as string);
    expect(modules.length).toBeGreaterThan(0);
    for (const name of modules) expect(names, `${name} is missing from the index`).toContain(name);
  });

  it('names no private member and nothing outside the scope', () => {
    const privateNames = new Set(
      everyManifest()
        .filter(({ manifest }) => manifest['private'] === true)
        .map(({ manifest }) => manifest['name']),
    );
    for (const name of names) {
      expect(privateNames.has(name), `${name} is private`).toBe(false);
      expect(name.startsWith(SCOPE), `${name} is outside ${SCOPE}`).toBe(true);
    }
  });

  it('carries each package at the version its own manifest declares, sorted by name', () => {
    const byName = new Map(everyManifest().map(({ manifest }) => [manifest['name'], manifest['version']]));
    for (const entry of index.packages) expect(entry.version).toBe(byName.get(entry.name));
    expect(names).toEqual([...names].sort());
  });

  it('is the population `publishablePackages()` yields, narrowed to the scope — one rule', () => {
    const publishable = publishablePackages(PACKAGES_ROOT)
      .filter((pkg) => pkg.name.startsWith(SCOPE))
      .map((pkg) => pkg.name)
      .sort();
    expect(names).toEqual(publishable);
  });

  it('the acceptance criterion reads the same derivation rather than restating it', () => {
    const harness = readFileSync(
      join(REPOSITORY_ROOT, 'backend/scripts/acceptance/instance.ts'),
      'utf8',
    );
    expect(harness).toContain("from '@endora-commerce/cli/lib/release-index.js'");
    expect(harness).not.toMatch(/function publishablePackages\(/);
  });
});

describe('the built artefact', () => {
  it('`dist/release-index.json` is the derivation over this workspace, as built', () => {
    const built = join(PACKAGE_ROOT, 'dist', RELEASE_INDEX_FILE);
    expect(existsSync(built), `${built} is absent — run \`pnpm run build:packages\``).toBe(true);
    expect(parseReleaseIndex(readFileSync(built, 'utf8'), built)).toEqual(
      releaseIndexOf(PACKAGES_ROOT, SCOPE),
    );
  });

  it('is never committed: it lives under `dist`, which the repository ignores', () => {
    const ignore = readFileSync(join(REPOSITORY_ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\/?(?:\*\*\/)?dist\/?$/m);
  });
});

describe('parseReleaseIndex', () => {
  it('refuses a document that is not an index, naming where it came from', () => {
    expect(() => parseReleaseIndex('{"packages": [{"name": 1}]}', '/x/release-index.json')).toThrow(
      /\/x\/release-index\.json/,
    );
    expect(() => parseReleaseIndex('not json', '/x/release-index.json')).toThrow(
      /\/x\/release-index\.json/,
    );
    expect(() => parseReleaseIndex('{"packages": []}', '/x/release-index.json')).toThrow(/no package/);
  });
});
