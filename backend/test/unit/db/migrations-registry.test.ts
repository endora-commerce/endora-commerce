import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationObject } from '@mikro-orm/core';
import config from '../../../src/db/mikro-orm.config.js';

/**
 * Guard against the "added a migration file but forgot to register it" class
 * of bug. `mikro-orm.config.ts` keeps an explicit `migrationsList` (no glob
 * discovery — see the comment in that file for why), so a migration that
 * lives on disk but is missing from the list is invisible to the migrator,
 * `migration:pending` silently reports "no pending migrations", and the
 * runtime crashes the first time something queries the missing table.
 *
 * This test enforces the round-trip: every migration class derived from a
 * `*_*.ts` file under `src/db/migrations/` or `src/modules/<x>/migrations/`
 * is in `migrationsList`, and every entry in `migrationsList` has a file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '../../..');
const dbMigrationsDir = resolve(backendRoot, 'src/db/migrations');
const modulesRoot = resolve(backendRoot, 'src/modules');

const MIGRATION_FILE_RE = /^(\d+)_([a-z0-9_]+)\.ts$/;

interface DiscoveredMigration {
  /** Absolute file path. */
  path: string;
  /** Class name derived from the filename per project convention. */
  className: string;
}

function classNameFromFile(filename: string): string {
  const match = MIGRATION_FILE_RE.exec(filename);
  if (!match) {
    throw new Error(`Unexpected migration filename: ${filename}`);
  }
  const [, number, rest] = match;
  const titleCase = rest!
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `Migration${number}${titleCase}`;
}

function listMigrationFiles(dir: string): DiscoveredMigration[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .map((name) => ({
      path: resolve(dir, name),
      className: classNameFromFile(name),
    }));
}

function discoverAllMigrations(): DiscoveredMigration[] {
  const moduleDirs = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(modulesRoot, entry.name, 'migrations'));
  return [
    ...listMigrationFiles(dbMigrationsDir),
    ...moduleDirs.flatMap(listMigrationFiles),
  ];
}

function isMigrationObject(
  entry: MigrationObject | { new (...args: never[]): unknown },
): entry is MigrationObject {
  return typeof entry === 'object' && 'name' in entry && 'class' in entry;
}

describe('migrationsList registration guard', () => {
  const onDisk = discoverAllMigrations();
  const onDiskNames = new Set(onDisk.map((m) => m.className));
  const rawList = config.migrations?.migrationsList ?? [];
  const registered: MigrationObject[] = rawList.filter(isMigrationObject);
  const registeredNames = new Set(registered.map((m) => m.name));

  it('discovers at least one migration file (sanity check)', () => {
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it.each(onDisk.map((m) => [m.className, m.path]))(
    '%s is registered in mikro-orm.config.ts',
    (className) => {
      expect(
        registeredNames.has(className),
        `Migration file for ${className} exists on disk but is not in ` +
          `migrationsList — add an import + entry in ` +
          `backend/src/db/mikro-orm.config.ts.`,
      ).toBe(true);
    },
  );

  it('every registered migration entry corresponds to a file on disk', () => {
    const orphans = [...registeredNames].filter(
      (name) => !onDiskNames.has(name),
    );
    expect(
      orphans,
      `migrationsList references entries with no matching file on disk: ` +
        orphans.join(', '),
    ).toEqual([]);
  });

  it('registry entry name matches its class.name', () => {
    const mismatched = registered
      .filter((entry) => entry.class.name !== entry.name)
      .map((entry) => `${entry.name} (class.name=${entry.class.name})`);
    expect(
      mismatched,
      `migrationsList entries whose name field disagrees with the imported ` +
        `class.name: ${mismatched.join(', ')}`,
    ).toEqual([]);
  });
});
