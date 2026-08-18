import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SERVICE_DEPENDENT_UNIT_TESTS,
  type ServiceDependentUnitTest,
} from '../../service-dependent-unit-tests.js';

/**
 * Keeps `SERVICE_DEPENDENT_UNIT_TESTS` honest in both directions (issue #211).
 *
 * That list is what `vitest.unit.config.ts` excludes, so it decides which unit
 * tests the fast, service-less job runs. Both ways of being wrong cost
 * something real:
 *
 *   - **unledgered** — a new unit test that boots the harness is included in
 *     the fast run and fails at the seam. Loud, but the message should name the
 *     ledger, and this test is where that instruction lives.
 *   - **stale** — a listed file that no longer touches a service stays excluded
 *     forever. Nothing fails; the fast job just quietly stops covering it. That
 *     is the direction a one-way list cannot see, and the reason this test
 *     sweeps both.
 *
 * Detection is deliberately narrow: **column-zero import statements only**.
 * `test/unit/scripts/*` is full of source fixtures that contain the same import
 * lines as quoted, indented strings, and a looser scan would report the
 * check-script tests as harness users. The narrowness is safe because a real
 * top-level import is always at column zero — and a file that reached a service
 * some other way would still fail loudly at the seam.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
/**
 * Both roots the fast run includes: `test/unit` and the unit tests that live
 * beside their source. A ledger that swept only one of them would be a two-way
 * check over half a population.
 */
const SCANNED_ROOTS = [join(BACKEND_ROOT, 'test', 'unit'), join(BACKEND_ROOT, 'src')];

/** A top-level (column-zero) import statement, single- or multi-line. */
const TOP_LEVEL_IMPORT = /^import\b[\s\S]*?from\s*'([^']+)';/gm;

function unitTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...unitTestFiles(full));
    } else if (entry.name.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

function serviceNeededBy(source: string): ServiceDependentUnitTest['needs'] | undefined {
  let needsRedis = false;
  for (const match of source.matchAll(TOP_LEVEL_IMPORT)) {
    const statement = match[0];
    const specifier = match[1] ?? '';
    // `import type` imports a shape, never a connection.
    if (/^import\s+type\b/.test(statement)) continue;
    if (/helpers\/test-server\.js$|helpers\/test-db\.js$/.test(specifier)) return 'postgres';
    if (specifier === 'ioredis') needsRedis = true;
  }
  return needsRedis ? 'redis' : undefined;
}

describe('service-dependent unit tests ledger', () => {
  const files = SCANNED_ROOTS.flatMap(unitTestFiles);

  it('reads both roots — a green result may not mean "found nothing"', () => {
    // 339 files stood here when the ledger landed (315 under test/unit, 24
    // beside their source). The floor is a broken-walk detector, not a target:
    // a wrong root, a rename or a failed readdir must fail this test rather
    // than empty the population and pass.
    expect(files.length).toBeGreaterThan(200);
  });

  const observed = new Map<string, ServiceDependentUnitTest['needs']>();
  for (const file of files) {
    const needs = serviceNeededBy(readFileSync(file, 'utf8'));
    if (needs) observed.set(relative(BACKEND_ROOT, file), needs);
  }

  it('lists every unit test that opens a service connection', () => {
    const ledgered = new Set(SERVICE_DEPENDENT_UNIT_TESTS.map((entry) => entry.path));
    const unledgered = [...observed.keys()].filter((path) => !ledgered.has(path)).sort();
    expect(
      unledgered,
      'These unit tests reach a live service but are not in SERVICE_DEPENDENT_UNIT_TESTS, ' +
        'so the fast run (pnpm --filter backend run test:unit:fast) will fail on them. ' +
        'Add each with the service it needs and why it uses the real one.',
    ).toEqual([]);
  });

  it('lists nothing that has stopped needing a service', () => {
    const stale = SERVICE_DEPENDENT_UNIT_TESTS.filter(
      (entry) => !observed.has(entry.path),
    ).map((entry) => entry.path);
    expect(
      stale,
      'These files are excluded from the fast unit run but no longer import a service ' +
        'harness — either they were deleted or renamed, or they were converted to doubles. ' +
        'Remove the entry so the fast job starts covering them again.',
    ).toEqual([]);
  });

  it('agrees with each entry about which service it needs', () => {
    const disagreements = SERVICE_DEPENDENT_UNIT_TESTS.filter(
      (entry) => observed.has(entry.path) && observed.get(entry.path) !== entry.needs,
    ).map((entry) => `${entry.path}: ledger says ${entry.needs}, file imports ${observed.get(entry.path)}`);
    expect(disagreements).toEqual([]);
  });

  it('gives every entry a reason', () => {
    const unexplained = SERVICE_DEPENDENT_UNIT_TESTS.filter(
      (entry) => entry.reason.trim().length < 20,
    ).map((entry) => entry.path);
    expect(unexplained).toEqual([]);
  });
});
