import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@b2b/contracts';
import { defineModuleManifest } from '@b2b/contracts';
import {
  orderMigrations,
  type MigrationClass,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';

/**
 * D-44 — a `nonBindingDependencies` entry cannot change an emitted migration
 * order.
 *
 * This is the property D-44 §8 singled out as "the one most likely to be broken
 * by a well-meaning later edit": the field looks like a dependency, the install
 * order reads dependencies, and unioning the three arrays in the one expression
 * that builds the ordering graph is a two-word change that no type would catch.
 * What it would buy is a cross-module foreign key whose ordering claim lives in
 * an array `fk-dependency-drift.test.ts` does not read — a table created after
 * the table it references, on a fresh database only.
 *
 * Both halves are asserted, because either alone is defeatable: the behaviour,
 * over the ordering function itself, and the derivation, at the one site that
 * feeds it.
 */

const UNCORRECTED_THROUGH = '20260801T000000';
const HORIZON_DAYS = 45;

/** Builds a class whose `.name` is exactly the supplied migration name. */
function migrationClass(name: string): MigrationClass {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationClass;
}

function entry(moduleId: string, stamp: string, tail: string): MigrationRegistryEntry {
  return { moduleId, cls: migrationClass(`Migration${stamp}${tail}`) };
}

/**
 * The production derivation, spelled exactly as `src/db/mikro-orm.config.ts`
 * spells it. A test that built the graph its own way would pass while the real
 * one drifted.
 */
function orderingGraph(
  manifests: readonly ModuleManifest[],
): ReadonlyMap<string, readonly string[]> {
  return new Map<string, readonly string[]>([
    ['core', []],
    ...manifests.map((manifest) => [manifest.id, manifest.dependencies ?? []] as const),
  ]);
}

/**
 * `reader`'s migration is stamped *before* `writer`'s, and both are past the
 * watermark — so a declared dependency inverts them and anything else does not.
 */
const ENTRIES: readonly MigrationRegistryEntry[] = [
  entry('reader', '20260901T090000', 'ReaderTable'),
  entry('writer', '20260902T090000', 'WriterTable'),
];

function emitted(manifests: readonly ModuleManifest[]): string[] {
  return orderMigrations({
    entries: ENTRIES,
    moduleDependencies: orderingGraph(manifests),
    uncorrectedThrough: UNCORRECTED_THROUGH,
    correctionHorizonDays: HORIZON_DAYS,
  }).map((migration) => migration.name);
}

const writer = defineModuleManifest({
  id: 'writer',
  name: 'Writer',
  version: '1.0.0',
  dependencies: [],
});

const readerDeclaring = defineModuleManifest({
  id: 'reader',
  name: 'Reader',
  version: '1.0.0',
  dependencies: ['writer'],
});

const readerWithdrawing = defineModuleManifest({
  id: 'reader',
  name: 'Reader',
  version: '1.0.0',
  dependencies: [],
  nonBindingDependencies: [
    {
      moduleId: 'writer',
      name: 'writerToolRegistry',
      kind: 'contributes-to',
      reason:
        'Pushes an inert descriptor into the writer catalogue at boot; nothing is read back.',
    },
  ],
});

describe('nonBindingDependencies — invisible to the migration order', () => {
  it('a declared dependency does correct an inverted pair', () => {
    // The control. Without it the assertion below would pass on a graph that
    // corrects nothing at all.
    expect(emitted([writer, readerDeclaring])).toEqual([
      'Migration20260902T090000WriterTable',
      'Migration20260901T090000ReaderTable',
    ]);
  });

  it('the same edge declared as non-binding leaves the order chronological', () => {
    expect(emitted([writer, readerWithdrawing])).toEqual([
      'Migration20260901T090000ReaderTable',
      'Migration20260902T090000WriterTable',
    ]);
  });

  it('the ordering graph is built from `dependencies` and from nothing else', () => {
    // The derivation, at its one production site. `orderMigrations` takes a map
    // and cannot defend this itself, so the guard has to read the expression
    // that builds the map.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/db/mikro-orm.config.ts', import.meta.url)),
      'utf8',
    );
    const graphExpression = /moduleDependencies\s*=\s*new Map[\s\S]*?\n\]\);/.exec(source);

    expect(graphExpression, 'the moduleDependencies map moved or was renamed').not.toBeNull();
    expect(graphExpression?.[0]).toContain('manifest.dependencies');
    expect(graphExpression?.[0]).not.toContain('nonBindingDependencies');
    expect(graphExpression?.[0]).not.toContain('acknowledgedDependencies');
  });
});
