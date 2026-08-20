import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIGRATOR_DRIVING_TESTS } from '../../migrator-driving-tests.js';

/**
 * Keeps `MIGRATOR_DRIVING_TESTS` honest in both directions (issue #189).
 *
 * A file that drives the real migrator mutates the schema of the one database
 * every other file in the invocation shares, and it does so *outside* any
 * transaction the rollback fixture could undo. Under per-invocation isolation
 * that database is the run's only copy, so a file whose migration sequence dies
 * half-way does not fail alone: measured, one such file turned into 21 red
 * files in `test/integration/catalog`, 20 of them on a truncate against tables
 * that were no longer there, each with a message that pointed at itself.
 *
 * So a migrator-driving file takes a database of its own — `setupMigratorTestDb`
 * clones the same template the run was cloned from — and this ledger is what
 * makes that a rule rather than a habit. Both directions cost something:
 *
 *   - an unledgered file is one driving the migrator against the shared run
 *     database, which is the 21-red failure waiting to happen again;
 *   - a stale entry is a file that has stopped driving the migrator and is
 *     still paying for a database clone nobody needs, under a reason that has
 *     quietly become untrue.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
/**
 * Test *files*, which is what this rule is about. `test/helpers/test-db.ts`
 * drives the migrator too — it is the seam's own shared-mode compensation — and
 * it is deliberately outside the population: it is the thing files are supposed
 * to go through, not one of them.
 */
const TEST_ROOT = join(BACKEND_ROOT, 'test');

/**
 * The migrator handle, in the one shape that reaches the real thing. A test
 * that builds a double and passes it through a seam — `migratorFor` in the
 * lifecycle orchestrator — never touches the schema and is not this population.
 */
const DRIVES_THE_MIGRATOR = /\.getMigrator\(\)/;

/** The seam a ledgered file must be using. */
const OWN_DATABASE_SEAM = /setupMigratorTestDb\(/;

/**
 * This file, by its exact path — its job is to spell the shape it refuses, so
 * it matches its own predicate and always will. One path, never a filename
 * rule: a second ledger test would be inside the population, which is right.
 */
const SPELLS_THE_SHAPE = 'test/unit/harness/migrator-driving-ledger.test.ts';

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...testFiles(full));
    } else if (entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('migrator-driving tests ledger', () => {
  const files = testFiles(TEST_ROOT);

  it('reads the whole test tree — a green result may not mean "found nothing"', () => {
    // 1181 files stood here when the ledger landed. The floor is a broken-walk
    // detector, not a target: a wrong root or a failed readdir must fail this
    // test rather than empty the population and report clean.
    expect(files.length).toBeGreaterThan(500);
    // And the carve-out names a file that is there: a path typo would silently
    // put this file back in the population, or take a real one out of it.
    expect(files.map((file) => relative(BACKEND_ROOT, file))).toContain(SPELLS_THE_SHAPE);
  });

  const observed = files
    .map((file) => relative(BACKEND_ROOT, file))
    .filter(
      (path) =>
        path !== SPELLS_THE_SHAPE &&
        DRIVES_THE_MIGRATOR.test(readFileSync(join(BACKEND_ROOT, path), 'utf8')),
    )
    .sort();

  it('lists every test that drives the real migrator', () => {
    const ledgered = new Set(MIGRATOR_DRIVING_TESTS.map((entry) => entry.path));
    const unledgered = observed.filter((path) => !ledgered.has(path));
    expect(
      unledgered,
      'These tests call orm.getMigrator() against a live database. That mutates the schema ' +
        'every other file in the invocation shares, and a sequence that dies half-way takes ' +
        'them all with it. Take a database of your own with setupMigratorTestDb() and add an ' +
        'entry to MIGRATOR_DRIVING_TESTS saying what the file drives the migrator for.',
    ).toEqual([]);
  });

  it('lists nothing that has stopped driving it', () => {
    const stale = MIGRATOR_DRIVING_TESTS.map((entry) => entry.path).filter(
      (path) => !observed.includes(path),
    );
    expect(
      stale,
      'These files are ledgered as driving the migrator but no longer call getMigrator() — ' +
        'either they were deleted or renamed, or they stopped. Remove the entry, and the ' +
        'database clone it pays for.',
    ).toEqual([]);
  });

  it('has every ledgered file taking a database of its own', () => {
    const sharing = MIGRATOR_DRIVING_TESTS.filter((entry) => {
      const source = readFileSync(join(BACKEND_ROOT, entry.path), 'utf8');
      return !OWN_DATABASE_SEAM.test(source);
    }).map((entry) => entry.path);
    expect(
      sharing,
      'A ledger entry is not the containment — setupMigratorTestDb() is. These files are ' +
        'listed but still run against the invocation\'s shared run database.',
    ).toEqual([]);
  });

  it('gives every entry a reason', () => {
    const unexplained = MIGRATOR_DRIVING_TESTS.filter(
      (entry) => entry.reason.trim().length < 20,
    ).map((entry) => entry.path);
    expect(unexplained).toEqual([]);
  });
});
