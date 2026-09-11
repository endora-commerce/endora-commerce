import { describe, expect, it } from 'vitest';
import {
  configuredMigrationsFrom,
  coreMigrationOwnership,
  migrationOwnershipOf,
} from '../../../src/db/configured-migrations.js';
import type { MigrationRegistryEntry } from '@endora-commerce/platform/db';

/**
 * Who owns which migration, and the distinction the lifecycle orchestrator's
 * hard uninstall rests on (feature 080, T033 — D-155.3(c)).
 *
 * `revertMigrationsFor` used to filter the committed registry and, on an empty
 * filter, warn and return `[]`. That is two different situations sharing one
 * answer: *"this module owns no migration"*, which is true of 39 core modules
 * and is fine, and *"the registry I was handed cannot answer for this module"*,
 * which is true of an installed extension package — whose migrations exist only
 * in the merged runtime order — and which made a hard uninstall drop the
 * registration and leave the package's table in the database.
 *
 * So the seam that knows the difference answers `[] | null`, in the idiom
 * `allowedIdsFor(): Promise<string[] | null>` already uses here: a caller
 * cannot collapse the two by accident, because `null` is not a list of names.
 */

function entry(moduleId: string, name: string): MigrationRegistryEntry {
  return { moduleId, cls: { name } as unknown as MigrationRegistryEntry['cls'] };
}

describe('migration ownership', () => {
  it('distinguishes "owns none" from "cannot answer"', () => {
    const ownership = migrationOwnershipOf([entry('orders', 'MigrationAOrders')], [
      'orders',
      'quiet',
    ]);

    // A covered module that registered nothing: an empty list, and the caller
    // may go on.
    expect(ownership.migrationNamesFor('quiet')).toEqual([]);
    // A module this registry never heard of: `null`, and the caller must stop.
    expect(ownership.migrationNamesFor('loyalty')).toBeNull();
  });

  it('returns a module\'s names ascending, which for one module is execution order', () => {
    const ownership = migrationOwnershipOf(
      [
        entry('orders', 'Migration20260901T000000OrdersTwo'),
        entry('orders', 'Migration20260801T000001OrdersOne'),
        entry('catalog', 'Migration20260801T000002CatalogOne'),
      ],
      ['orders', 'catalog'],
    );

    // `orderMigrations` emits a module's chain contiguously and ascending by
    // timestamp, and the timestamp is the head of the class name — so sorting
    // the names is the resolved order and needs no second computation.
    expect(ownership.migrationNamesFor('orders')).toEqual([
      'Migration20260801T000001OrdersOne',
      'Migration20260901T000000OrdersTwo',
    ]);
  });

  it('covers every core module the committed index registers, including the migration-less ones', () => {
    const ownership = coreMigrationOwnership();

    // The cross-cutting pseudo-module owning `src/db/migrations/`.
    expect(ownership.migrationNamesFor('core')).not.toBeNull();
    expect(ownership.migrationNamesFor('orders')).not.toBeNull();
    // Derived, never a number written down: every id the index holds is covered.
    expect(ownership.coveredModuleIds.size).toBeGreaterThan(60);
  });

  it('cannot answer for a package, which is what makes the core-only default fail closed', () => {
    // The core registry is a walk of `backend/src`; an installed package
    // contributes nothing to it and never will (D-119). So a core-only
    // orchestrator must refuse rather than report "nothing to revert".
    expect(coreMigrationOwnership().migrationNamesFor('acceptance_probe')).toBeNull();
  });
});

describe('the merged order', () => {
  const coreEntries = [entry('core', 'Migration20260101T000000CoreInit')];
  const coreModuleDependencies = new Map<string, readonly string[]>([
    ['core', []],
    ['orders', []],
  ]);

  it('slots a package chain in and covers the package\'s own module id', () => {
    const configured = configuredMigrationsFrom({
      coreEntries,
      coreModuleDependencies,
      packages: [
        {
          id: 'loyalty',
          packageName: '@vendor/mod-loyalty',
          version: '1.0.0',
          migrationsDirectory: '/instance/node_modules/@vendor/mod-loyalty/dist/migrations',
          dependencies: [],
        migrations: [
            { ...entry('loyalty', 'Migration20260821T120000LoyaltyInit'), origin: 'external' },
          ],
          entities: [],
        },
      ],
    });

    expect(configured.names).toContain('Migration20260821T120000LoyaltyInit');
    expect(configured.registered.find((m) => m.name === 'Migration20260821T120000LoyaltyInit')
      ?.origin).toBe('external');
    // The whole point of injecting it: the orchestrator can now enumerate the
    // package's chain instead of refusing.
    expect(configured.ownership.migrationNamesFor('loyalty')).toEqual([
      'Migration20260821T120000LoyaltyInit',
    ]);
  });

  it('is bare core when nothing is installed, and still covers every core module', () => {
    const configured = configuredMigrationsFrom({
      coreEntries,
      coreModuleDependencies,
      packages: [],
    });

    expect(configured.names).toEqual(['Migration20260101T000000CoreInit']);
    expect(configured.ownership.migrationNamesFor('orders')).toEqual([]);
    expect(configured.ownership.migrationNamesFor('loyalty')).toBeNull();
  });

  it('keeps a package migration out of the frozen historical prefix whatever it stamps', () => {
    // `BASELINE_THROUGH` is a claim about *our* history. A package's stamp is
    // chosen by a stranger, so membership takes the origin as well (D-114).
    const configured = configuredMigrationsFrom({
      coreEntries,
      coreModuleDependencies,
      packages: [
        {
          id: 'loyalty',
          packageName: '@vendor/mod-loyalty',
          version: '1.0.0',
          migrationsDirectory: null,
          dependencies: [],
        migrations: [
            { ...entry('loyalty', 'Migration20250101T000000LoyaltyInit'), origin: 'external' },
          ],
          entities: [],
        },
      ],
    });

    // The core baseline entry comes first even though the package back-dated
    // its stamp by a year.
    expect(configured.names).toEqual([
      'Migration20260101T000000CoreInit',
      'Migration20250101T000000LoyaltyInit',
    ]);
  });
});
