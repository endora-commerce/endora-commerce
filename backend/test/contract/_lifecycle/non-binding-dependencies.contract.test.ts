import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { defineModuleManifest } from '@endora-commerce/contracts';
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

const BASELINE_THROUGH = '20260801T000000';

/** Builds a class whose `.name` is exactly the supplied migration name. */
function migrationClass(name: string): MigrationClass {
  const holder = { [name]: class {} };
  return holder[name] as unknown as MigrationClass;
}

function entry(moduleId: string, stamp: string, tail: string): MigrationRegistryEntry {
  return { moduleId, cls: migrationClass(`Migration${stamp}${tail}`) };
}

/**
 * The production derivation, spelled exactly as the one site below spells it.
 * A test that built the graph its own way would pass while the real one
 * drifted.
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
 * watermark — so a declared dependency puts `writer` first and anything else
 * leaves the two modules unrelated, where the id sorts them (`reader` first).
 */
const ENTRIES: readonly MigrationRegistryEntry[] = [
  entry('reader', '20260901T090000', 'ReaderTable'),
  entry('writer', '20260902T090000', 'WriterTable'),
];

function emitted(manifests: readonly ModuleManifest[]): string[] {
  return orderMigrations({
    entries: ENTRIES,
    moduleDependencies: orderingGraph(manifests),
    baselineThrough: BASELINE_THROUGH,
  }).migrations.map((migration) => migration.name);
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

const SRC_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Every place in `backend/src` that *builds* the ordering graph, with the
 * `new Map(...)` argument list of each.
 *
 * This used to name `src/db/mikro-orm.config.ts` and match
 * `/moduleDependencies\s*=\s*new Map[\s\S]*?\n\]\);/`, and issue #289 broke it
 * three ways at once: the map moved to `configured-migrations.ts`, the `=`
 * became a `:` as it turned into an inline property, and the `\n]);` terminator
 * became `\n  ]),`. Any one of those alone would have been enough. Two things
 * follow, and they pull in the same direction.
 *
 * The first is that a path is the wrong handle. The property D-44 asks about is
 * *"nowhere in this platform's sources is the ordering graph built from
 * anything but `dependencies`"*, which is a claim about the tree and not about
 * a filename, so the guard resolves the site instead of being told where it is.
 * A benign move now stays green — that is deliberate, and it is what cost this
 * repository a red `master` for the property's sake without the property ever
 * having been violated.
 *
 * The second is that resolving is only safe if *not finding it* is a failure,
 * so the caller asserts **exactly one** site. Zero means renamed, deleted, or
 * moved out of `src` — the cases where a path-based guard was genuinely
 * earning its keep, all still red. More than one means a second derivation
 * appeared, which the old single-file guard could not see at all and which is
 * precisely how the field would be unioned in without this test noticing.
 *
 * The argument list is taken by bracket counting rather than by a terminator
 * pattern, so the reformatting half of #289 cannot break it again.
 */
function orderingGraphSites(): { file: string; expression: string }[] {
  const files = walkSources(SRC_ROOT);

  // The vacuous-pass floor: a walk that read nothing would report no sites,
  // and "no sites" is this test's loudest failure — it must mean the map is
  // gone, never that the walk was blind.
  expect(files.length, `no TypeScript sources under ${SRC_ROOT}`).toBeGreaterThan(0);

  const sites: { file: string; expression: string }[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Both binding shapes: a `const … = new Map` and an inline `…: new Map`
    // property. #289 turned the first into the second.
    const pattern = /moduleDependencies\s*[:=]\s*new Map\s*(?:<[^>]*>)?\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let end = -1;
      for (let i = open; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      expect(end, `unbalanced parentheses after the map in ${file}`).toBeGreaterThan(open);
      sites.push({ file, expression: source.slice(match.index, end + 1) });
    }
  }
  return sites;
}

describe('nonBindingDependencies — invisible to the migration order', () => {
  it('a declared dependency does order the pair', () => {
    // The control. Without it the assertion below would pass on a graph that
    // reads no edges at all.
    expect(emitted([writer, readerDeclaring])).toEqual([
      'Migration20260902T090000WriterTable',
      'Migration20260901T090000ReaderTable',
    ]);
  });

  it('the same edge declared as non-binding leaves the two modules unrelated', () => {
    expect(emitted([writer, readerWithdrawing])).toEqual([
      'Migration20260901T090000ReaderTable',
      'Migration20260902T090000WriterTable',
    ]);
  });

  it('the ordering graph is built from `dependencies` and from nothing else', () => {
    // The derivation, at its one production site. `orderMigrations` takes a map
    // and cannot defend this itself, so the guard has to read the expression
    // that builds the map — wherever in `src` that expression lives.
    const sites = orderingGraphSites();

    expect(
      sites.map((site) => site.file),
      'the moduleDependencies map was renamed, deleted or moved out of backend/src — ' +
        'or a second derivation of the ordering graph appeared, which is the change ' +
        'this test exists to refuse',
    ).toHaveLength(1);

    const expression = sites[0]!.expression;
    expect(expression).toContain('manifest.dependencies');
    expect(expression).not.toContain('nonBindingDependencies');
    expect(expression).not.toContain('acknowledgedDependencies');
  });
});
