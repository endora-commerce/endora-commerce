import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMigrationTables, kernelOwnedTables } from '../../helpers/migration-tables.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.js';

/**
 * Feature 072 T020 — the kernel's schema is filed under `core`, not under a
 * module.
 *
 * `ModuleLifecycleOrchestrator.revertMigrationsFor()` selects the migrations to
 * revert by `MIGRATION_REGISTRY` entry `moduleId`. A migration that creates or
 * alters a kernel-owned table while filed under `settings` or `sales_channels`
 * therefore reverts on `modules:uninstall --hard <that module>`, dropping
 * schema the kernel — and every module that reads through it — depends on.
 *
 * Pure: no database, no ORM bootstrap. The kernel-owned table set is resolved
 * from the entity tree, so absorbing another entity into the kernel extends
 * this check automatically instead of silently narrowing it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, '../../../src');

const kernelTables = kernelOwnedTables(backendSrc);
const migrations = collectMigrationTables(backendSrc);

describe('kernel-owned schema is filed under the core migration group', () => {
  it('resolves a non-trivial kernel table set (guards against a silent empty scan)', () => {
    expect([...kernelTables].sort()).toEqual([
      'audit_log_entries',
      // D-37 absorbed the presence machinery, `ModuleRegistration` with it. The
      // migration was already filed under `core`, so only this guard moved.
      'module_registrations',
      'sales_channels',
      'setting_group_sales_channels',
      'setting_groups',
      'setting_sales_channels',
      'setting_values',
      'settings',
    ]);
    expect(migrations.length).toBeGreaterThan(100);
  });

  it('no module-owned migration creates or alters a kernel-owned table', () => {
    const offenders = migrations
      .filter((migration) => migration.groupId !== 'core')
      .flatMap((migration) => {
        const touched = [...migration.tables].filter((table) => kernelTables.has(table)).sort();
        return touched.length === 0
          ? []
          : [`${migration.relativePath} writes to ${touched.join(', ')}`];
      });

    expect(
      offenders,
      `these migrations write to kernel-owned tables from a module group, so a ` +
        `hard uninstall of that module would revert them — move them to ` +
        `backend/src/db/migrations/ and re-register them under 'core':\n  ` +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('registers every migration that writes to a kernel table under the core module id', () => {
    const registryOwners = new Map(
      MIGRATION_REGISTRY.map((entry) => [entry.cls.name, entry.moduleId] as const),
    );
    const mismatched = migrations
      .filter((migration) => [...migration.tables].some((table) => kernelTables.has(table)))
      .filter((migration) => registryOwners.get(migration.className) !== 'core')
      .map(
        (migration) =>
          `${migration.className} is registered under ` +
          `"${registryOwners.get(migration.className) ?? '<unregistered>'}"`,
      );

    expect(mismatched, mismatched.join('; ')).toEqual([]);
  });

  it('leaves the settings and sales_channels modules owning no migration at all', () => {
    // Both modules' entire schema is the kernel's since T018/T019. Nothing is
    // left for them to own, so a hard uninstall of either reverts nothing.
    for (const moduleId of ['settings', 'sales_channels']) {
      const owned = MIGRATION_REGISTRY.filter((entry) => entry.moduleId === moduleId).map(
        (entry) => entry.cls.name,
      );
      expect(owned, `${moduleId} still owns: ${owned.join(', ')}`).toEqual([]);
    }
  });
});
