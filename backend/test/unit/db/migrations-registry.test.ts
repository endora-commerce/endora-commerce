import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
// Location only — which workspace members declare themselves modules. The
// recognizer, the class-name derivation and the walk below stay this file's own,
// which is what makes it an independent check of the committed artefact.
import {
  discoverModulePackages,
  isDeclaredEntryPoint,
  packageRelativePathOf,
  type ModulePackage,
} from '../../../scripts/lib/module-packages.js';

/**
 * Round-trip guard for the migration registry.
 *
 * `src/db/migrations-registry.generated.ts` keeps an explicit list of statically
 * imported migration classes (no glob discovery — Node's ESM loader cannot
 * transform `.ts` at runtime and it breaks under Vitest), so a migration that
 * lives on disk but is missing from the registry is invisible to the migrator,
 * `migration:pending` silently reports "no pending migrations", and the runtime
 * crashes the first time something queries the missing table.
 *
 * Since feature 071's F2 that list is **generated** from a filesystem walk, and
 * this file is emphatically not redundant because of it. It asserts the
 * property against the *committed* artefact using its own independent
 * implementation of the naming contract — a different recognizer, a different
 * class-name derivation, a different walk. So it fails on the one thing the
 * generator cannot catch about itself, a stale committed file (someone added a
 * migration and did not run `composer:generate`), and it fails on a generator
 * whose own walk narrowed, because two implementations would have to narrow
 * identically to agree. Do not fold it into the generator's own helpers.
 *
 * The naming and registration rules asserted here are specified once, in
 * specs/065-manifest-aware-migrations/contracts/naming-convention.md.
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '../../..');
const dbMigrationsDir = resolve(backendRoot, 'src/db/migrations');
const modulesRoot = resolve(backendRoot, 'src/modules');

/** contracts/naming-convention.md §1 — the only recognizer any tool may use. */
const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.ts$/;

/** contracts/naming-convention.md §4 — non-migration helpers in a migrations/ dir. */
const HELPER_ALLOW_LIST = new Set([
  'src/modules/quote_requests/migrations/status-mapping.ts',
]);

/** contracts/naming-convention.md §2. */
function classNameFromFile(filename: string): string {
  const match = MIGRATION_FILE_RE.exec(filename);
  if (!match) {
    throw new Error(`Unexpected migration filename: ${filename}`);
  }
  const [, stamp, tail] = match;
  const pascal = tail!
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `Migration${stamp}${pascal}`;
}

/** contracts/naming-convention.md §1 — segment normalization. */
function segmentOf(moduleId: string): string {
  return moduleId === 'core' ? 'core' : moduleId.replace(/^_/, '');
}

interface DiscoveredMigration {
  /** Repo-relative-to-backend path, for readable failure messages. */
  relativePath: string;
  filename: string;
  className: string;
  /** Owning module id — 'core' for src/db/migrations/. */
  moduleId: string;
}

/**
 * Every `migrations` directory under a module package, at any depth.
 *
 * A package's internal layout is its own — `module-package-layout.md` §1 puts
 * them at `src/migrations/`, and nothing in the check estate spells that — so
 * this mirrors `generate-composer.ts`'s `PACKAGE_MIGRATION_RE`, which is
 * "anywhere under a `migrations/` directory". `dist` is skipped: a built package
 * holds the same migrations compiled, and counting both would make this
 * round-trip fail on whether `pnpm run build:packages` had run.
 */
function migrationDirsUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const child = resolve(dir, entry.name);
    if (entry.name === 'migrations') out.push(child);
    else migrationDirsUnder(child, out);
  }
  return out;
}

function migrationDirs(): { dir: string; moduleId: string; owner?: ModulePackage }[] {
  const moduleDirs = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: resolve(modulesRoot, entry.name, 'migrations'),
      moduleId: entry.name,
    }));
  // A module that has become a workspace package (feature 080, T040b). Its
  // migrations are committed here and the committed registry configures them,
  // so leaving them out makes every one of them an orphan entry — which is what
  // this file reported on the day `blog` moved. The id is the package's declared
  // `endora.id` (D-142), never a path segment.
  const packageDirs = discoverModulePackages(resolve(backendRoot, '..')).flatMap((pkg) =>
    migrationDirsUnder(pkg.dir).map((dir) => ({ dir, moduleId: pkg.moduleId, owner: pkg })),
  );
  return [{ dir: dbMigrationsDir, moduleId: 'core' }, ...moduleDirs, ...packageDirs];
}

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.ts'));
}

function discoverAllMigrations(): DiscoveredMigration[] {
  const discovered: DiscoveredMigration[] = [];
  for (const { dir, moduleId } of migrationDirs()) {
    for (const filename of listTsFiles(dir)) {
      if (!MIGRATION_FILE_RE.test(filename)) continue;
      discovered.push({
        relativePath: relative(backendRoot, resolve(dir, filename)),
        filename,
        className: classNameFromFile(filename),
        moduleId,
      });
    }
  }
  return discovered;
}

const onDisk = discoverAllMigrations();
const onDiskByClassName = new Map(onDisk.map((migration) => [migration.className, migration]));
const registeredNames = MIGRATION_REGISTRY.map((entry) => entry.cls.name);

describe('migration registry round-trip', () => {
  it('discovers at least one migration file (sanity check)', () => {
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it.each(onDisk.map((migration) => [migration.className, migration.relativePath]))(
    '%s is registered in the committed migration registry',
    (className) => {
      expect(
        registeredNames.includes(className),
        `Migration file for ${className} exists on disk but is not in ` +
          `MIGRATION_REGISTRY. Regenerate and commit the artefact: ` +
          `pnpm --filter backend run composer:generate`,
      ).toBe(true);
    },
  );

  it('every registry entry corresponds to a file on disk', () => {
    const orphans = registeredNames.filter((name) => !onDiskByClassName.has(name));
    expect(
      orphans,
      `MIGRATION_REGISTRY references entries with no matching file on disk: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('registers every migration exactly once', () => {
    const seen = new Set<string>();
    const duplicates = registeredNames.filter((name) => !seen.add(name) && true);
    expect(duplicates, `duplicate registry entries: ${duplicates.join(', ')}`).toEqual([]);
    expect(registeredNames).toHaveLength(onDisk.length);
  });

  it('every entry declares the module that owns the file', () => {
    const mismatched = MIGRATION_REGISTRY.filter((entry) => {
      const file = onDiskByClassName.get(entry.cls.name);
      return file !== undefined && file.moduleId !== entry.moduleId;
    }).map((entry) => {
      const file = onDiskByClassName.get(entry.cls.name)!;
      return `${entry.cls.name} declares moduleId "${entry.moduleId}" but lives in ${file.relativePath} (owner "${file.moduleId}")`;
    });
    expect(mismatched, mismatched.join('; ')).toEqual([]);
  });

  it("every filename's segment equals the normalized owning module id", () => {
    const mismatched = onDisk
      .filter((migration) => {
        const segment = segmentOf(migration.moduleId);
        const tail = MIGRATION_FILE_RE.exec(migration.filename)![2]!;
        return tail !== segment && !tail.startsWith(`${segment}_`);
      })
      .map(
        (migration) =>
          `${migration.relativePath} must start its tail with the segment "${segmentOf(migration.moduleId)}"`,
      );
    expect(mismatched, mismatched.join('; ')).toEqual([]);
  });

  it('has no unrecognized .ts file in any migrations directory', () => {
    const strays: string[] = [];
    for (const { dir, owner } of migrationDirs()) {
      for (const filename of listTsFiles(dir)) {
        const absolute = resolve(dir, filename);
        const relativePath = relative(backendRoot, absolute);
        if (MIGRATION_FILE_RE.test(filename)) continue;
        if (HELPER_ALLOW_LIST.has(relativePath.split('\\').join('/'))) continue;
        // A package's `./migrations` subpath has to point at a file, and that
        // file is the barrel re-exporting the classes. It is an entry point by
        // **declaration** — read off the package's own `exports` map — rather
        // than a §4 helper, so it needs no allow-list entry and the next module
        // package needs none either.
        if (owner !== undefined && isDeclaredEntryPoint(owner, packageRelativePathOf(owner, absolute))) {
          continue;
        }
        strays.push(relativePath);
      }
    }
    expect(
      strays,
      `unrecognized .ts files in migrations directories (rename them per ` +
        `contracts/naming-convention.md §1, or add them to the helper allow-list): ${strays.join(', ')}`,
    ).toEqual([]);
  });

  it('has no legacy sequentially-numbered migration file left', () => {
    const legacy: string[] = [];
    for (const { dir } of migrationDirs()) {
      for (const filename of listTsFiles(dir)) {
        if (/^\d{3}_/.test(filename)) {
          legacy.push(relative(backendRoot, resolve(dir, filename)));
        }
      }
    }
    expect(legacy, `legacy-numbered migration files remain: ${legacy.join(', ')}`).toEqual([]);
  });
});
