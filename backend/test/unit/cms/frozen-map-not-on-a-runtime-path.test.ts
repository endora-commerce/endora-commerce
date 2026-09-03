import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Feature 096, T413 — the ruling's enforcement
 * (`contracts/block-name-check.md` §9).
 *
 * **The owner rejected a permanent alias map on 2026-09-02.** What this feature
 * ships instead is a *frozen historical constant*: names are namespaced once, in
 * the data, and the application then knows one vocabulary. The two designs are
 * the same file with different reachability, and **the difference is only real
 * while the constant cannot be read at runtime** — the first person to reach for
 * `FROZEN_BLOCK_RENAMES` inside a resolver turns this into the thing that was
 * rejected, silently and with no test going red anywhere else.
 *
 * So the subpath is what is asserted, not the file: a migration and the report
 * CLI may import `@endora-commerce/page-builder-core/migration`; nothing else
 * may. A relative import of the same file inside `page-builder-core` is out of
 * scope by construction — the package is the file's own home, and its own
 * barrel does not re-export it, which is what `./migration` being a subpath of
 * its own buys.
 */

const SUBPATH = '@endora-commerce/page-builder-core/migration';
const REPO = path.resolve(import.meta.dirname, '../../../..');

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.next',
  'coverage',
  'build',
  '.probe',
]);

/**
 * The two kinds of file that may name the subpath.
 *
 * A migration, because rewriting the stored names is what the map exists for;
 * and the operator's report, which classifies them and writes nothing. Both are
 * matched on **where the file is**, because that is the property the rule is
 * about — a file under `src/migrations/` is a migration whatever it is called.
 */
function isPermittedReader(relative: string): boolean {
  if (/(^|\/)src\/migrations\//.test(relative)) return true;
  if (relative.endsWith('packages/modules/cms/src/backend/cli/block-names.ts')) return true;
  // The package's own sources, where the file lives and is composed into the
  // subpath's barrel.
  if (relative.startsWith('packages/page-builder-core/src/migration/')) return true;
  // Tests are out of population by decision, in the idiom
  // `contracts/block-name-check.md` §2 states: a test's whole job may be to hold
  // the vocabulary the rule is about.
  if (relative.includes('/test/') || relative.endsWith('.test.ts')) return true;
  return false;
}

describe('the frozen rename map is not on a runtime path', () => {
  const readers: string[] = [];
  const files = globSync('**/*.{ts,tsx}', { cwd: REPO })
    .filter((f) => !f.split('/').some((segment) => SKIP_DIRECTORIES.has(segment)));

  for (const relative of files) {
    const source = readFileSync(path.join(REPO, relative), 'utf8');
    if (source.includes(SUBPATH)) readers.push(relative);
  }

  it('read a tree with sources in it', () => {
    // Exit-2 reasoning applied to a test: an empty walk would make the
    // assertion below vacuously true, and a green vacuous run is the one
    // outcome worse than a red one.
    expect(files.length).toBeGreaterThan(1000);
    expect(readers.length).toBeGreaterThan(0);
  });

  it('is imported only by a migration and by the operator report', () => {
    const offenders = readers.filter((relative) => !isPermittedReader(relative));
    expect(offenders, `${SUBPATH} reached from a runtime path`).toEqual([]);
  });

  it('is reached by all five rename migrations and by the report', () => {
    const migrations = readers.filter((r) => /src\/migrations\/.*namespace_block_names\.ts$/.test(r));
    expect(migrations).toHaveLength(5);
    expect(
      readers.some((r) => r.endsWith('packages/modules/cms/src/backend/cli/block-names.ts')),
    ).toBe(true);
  });

  it('is not re-exported from the package barrel', () => {
    // A barrel re-export would make the map reachable from every admin screen
    // that imports `@endora-commerce/page-builder-core`, which is all of them,
    // and this test would keep passing.
    const barrel = readFileSync(
      path.join(REPO, 'packages/page-builder-core/src/index.ts'),
      'utf8',
    );
    expect(barrel).not.toContain('FROZEN_BLOCK_RENAMES');
    expect(barrel).not.toContain('./migration');
  });
});
