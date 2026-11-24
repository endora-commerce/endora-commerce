import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1865 — the MikroORM CLI is not part of the toolchain.
 *
 * Migrations are created with `migration:new` and applied through
 * `src/db/migrate.ts` (`migration:up`, `db:fresh`, `setup`), which read the
 * migration order the installed manifests compute. `mikro-orm migration:create`
 * and `migration:generate` write into one configured path and cannot know the
 * owning module, so keeping `@mikro-orm/cli` installed kept a second,
 * unsupported entry point — and one Dependabot could move to another major on
 * its own (#150), which does not boot beside a `core` it does not match.
 *
 * Pure: reads the workspace manifests and the lockfile, nothing else.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

/** Every workspace member `pnpm-workspace.yaml` reaches, plus the root and the acceptance fixture. */
function manifestPaths(): readonly string[] {
  const globs = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
    .split('\n')
    .map((line) => /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)?.[1])
    .filter((glob): glob is string => glob !== undefined && !glob.startsWith('!'));
  const dirs = globs.flatMap((glob) => {
    if (!glob.endsWith('/*')) return [join(repoRoot, glob)];
    const parent = join(repoRoot, glob.slice(0, -2));
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name));
  });
  return [repoRoot, join(repoRoot, 'backend/acceptance/fixture-package'), ...dirs]
    .map((dir) => join(dir, 'package.json'))
    .filter((path) => existsSync(path));
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

describe('the MikroORM CLI is not installed (#1865)', () => {
  const manifests = manifestPaths();

  it('reads the whole workspace', () => {
    // backend, admin, storefront, docs and the packages — a glob that expanded
    // to nothing would make every assertion below vacuous.
    expect(manifests.length).toBeGreaterThan(20);
    expect(manifests).toContain(join(repoRoot, 'backend/package.json'));
  });

  it('no manifest declares @mikro-orm/cli', () => {
    const declaring = manifests.filter((path) => {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      return DEPENDENCY_FIELDS.some((field) =>
        Object.keys((manifest[field] ?? {}) as Record<string, string>).includes('@mikro-orm/cli'),
      );
    });
    expect(declaring).toEqual([]);
  });

  it('no manifest carries a `mikro-orm` configuration block', () => {
    const carrying = manifests.filter((path) => {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      return Object.hasOwn(manifest, 'mikro-orm');
    });
    expect(carrying).toEqual([]);
  });

  it('no script runs the `mikro-orm` binary', () => {
    const running: string[] = [];
    for (const path of manifests) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (/(^|[\s;&|])mikro-orm\s/.test(command)) running.push(`${path}: ${name}`);
      }
    }
    expect(running).toEqual([]);
  });

  it('the lockfile resolves no @mikro-orm/cli', () => {
    const lockfile = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
    expect(lockfile).not.toMatch(/@mikro-orm\/cli/);
  });
});
