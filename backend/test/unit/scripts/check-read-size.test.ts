import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseReadSize, type ParsedReadSize } from '../../../scripts/lib/read-size.js';
import {
  RECORDED_READ_SIZES,
  READ_SIZE_WITHOUT_A_SITE_POPULATION,
  READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE,
  readSizeBounds,
  type RecordedReadSize,
} from '../../helpers/check-read-sizes.js';

/**
 * Issue #244 — the ratchet on what each check *reads*.
 *
 * `check-inventory.test.ts` proves every check can still go red on a violation
 * it is supposed to see. That is one half of "a green means something"; this is
 * the other, and it is the half seven defects walked through. A check that
 * stops reading its population reports `violations=0` and passes the inventory
 * too — its analysis is intact, it simply has nothing to analyse.
 *
 * So each check is **spawned the way CI spawns it**, over the real tree, and
 * the read line it prints is compared with the number recorded in
 * `test/helpers/check-read-sizes.ts`. Three things are asserted, and they fail
 * for three different reasons:
 *
 *   1. **The line exists.** A check that discloses nothing is a check whose
 *      green cannot be told from a check that read nothing — the whole family.
 *   2. **The numbers are in band.** Materially fewer files or sites than
 *      recorded is the defect direction; materially more is a recorded number
 *      that has gone stale and stopped meaning anything. The band and the
 *      reasoning behind its two edges are in the helper.
 *   3. **The corroboration is the one recorded, and it holds.** A check that
 *      computes its own population and reports it has not closed #215 — that is
 *      the same value twice. Where an independent derivation exists the run
 *      must still name it *and* cover it in full; where none exists the record
 *      says so and `READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE` carries the
 *      reason, so "self-reported" is a statement rather than a silence.
 *
 * It spawns twenty-seven processes over the whole repository, which is why it
 * lives in its own file rather than inside the inventory: the inventory is pure
 * and fast, and a developer runs it constantly.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');
const run = promisify(execFile);

/** Long enough for the slowest check (the two full-tree shell scans). */
const SPAWN_TIMEOUT_MS = 240_000;

/**
 * How many checks run at once.
 *
 * A pool rather than batches: the two shell scans are several times slower than
 * the fastest tsx check, and a batch waits for its slowest member. Eight on a
 * sixteen-core box keeps the whole sweep near the sum of the slowest few.
 */
const CONCURRENCY = 8;

interface Observed {
  readonly output: string;
  readonly read: ParsedReadSize | null;
}

const observed = new Map<string, Observed>();

async function observe(script: string, recorded: RecordedReadSize): Promise<void> {
  const { kind, path, args } = recorded.run;
  const command = kind === 'tsx' ? 'pnpm' : 'bash';
  const argv = kind === 'tsx' ? ['exec', 'tsx', path, ...args] : [path, ...args];
  const cwd = kind === 'tsx' ? BACKEND_ROOT : REPO_ROOT;
  let output: string;
  try {
    const result = await run(command, argv, { cwd, maxBuffer: 64 * 1024 * 1024 });
    output = `${result.stdout}${result.stderr}`;
  } catch (error: unknown) {
    // A non-zero exit is not this file's business: a check may legitimately be
    // red on the working tree, and it still has to disclose what it read.
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
  observed.set(script, { output, read: parseReadSize(output) });
}

beforeAll(async () => {
  const queue = Object.entries(RECORDED_READ_SIZES);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < queue.length; index = next++) {
      const [script, recorded] = queue[index]!;
      await observe(script, recorded);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}, SPAWN_TIMEOUT_MS);

describe('every static check discloses the size of what it read', () => {
  for (const [script, recorded] of Object.entries(RECORDED_READ_SIZES)) {
    describe(script, () => {
      it('prints a read line', () => {
        const seen = observed.get(script);
        expect(seen, `${script} was never spawned`).toBeDefined();
        expect(
          seen?.read,
          `${script} printed no read line. Its output was:\n${seen?.output ?? ''}`,
        ).not.toBeNull();
        expect(seen?.read?.prefix).toBe(recorded.prefix.slice(1, -1));
      });

      it('opened a number of files inside the recorded band', () => {
        const read = observed.get(script)?.read;
        if (read === null || read === undefined) return; // reported by the test above
        const bounds = readSizeBounds(recorded.files);
        expect(
          read.files,
          `${script} read ${read.files} file(s); ${recorded.files} was recorded, band ` +
            `[${bounds.min}, ${bounds.max}]. Below it, the check has stopped reading part ` +
            'of its population. Above it, the record is stale — re-record it here, in the ' +
            'merge request that grew the tree, and never widen the band to pass.',
        ).toBeGreaterThanOrEqual(bounds.min);
        expect(read.files).toBeLessThanOrEqual(bounds.max);
      });

      it('examined the recorded finer population, or records that it has none', () => {
        const read = observed.get(script)?.read;
        if (read === null || read === undefined) return;
        if (recorded.sites === null) {
          expect(
            read.sites,
            `${script} now prints a site count; record it in check-read-sizes.ts and drop ` +
              'its entry from READ_SIZE_WITHOUT_A_SITE_POPULATION',
          ).toBeNull();
          return;
        }
        expect(read.sites, `${script} stopped printing a site count`).not.toBeNull();
        const bounds = readSizeBounds(recorded.sites);
        expect(
          read.sites,
          `${script} examined ${read.sites} site(s); ${recorded.sites} was recorded, band ` +
            `[${bounds.min}, ${bounds.max}]. This is the number issues #235 and #237 moved ` +
            'while the file count stood still.',
        ).toBeGreaterThanOrEqual(bounds.min);
        expect(read.sites!).toBeLessThanOrEqual(bounds.max);
      });

      it('corroborates its population the recorded way', () => {
        const read = observed.get(script)?.read;
        if (read === null || read === undefined) return;
        expect(
          read.coverage.map((c) => c.source).sort(),
          `${script} reconciles against a different set of derivations than recorded`,
        ).toEqual([...recorded.sources].sort());
        expect(read.selfReported).toBe(recorded.sources.length === 0);
        for (const coverage of read.coverage) {
          // The check exits 2 on a shortfall, so seeing one here means the
          // refusal itself stopped working.
          expect(
            coverage.covered,
            `${script} covered ${coverage.covered} of ${coverage.expected} ` +
              `${coverage.source} unit(s) and did not refuse`,
          ).toBe(coverage.expected);
          expect(coverage.expected).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe('the two ledgers stay two-way', () => {
  // Both directions, in the idiom of every other ledger in the tree: an
  // undeclared silence fails, and a declaration that no longer describes one
  // fails too. Without the second direction a check could gain an independent
  // source, or a site count, while a paragraph here went on explaining why it
  // has none.
  const scripts = Object.entries(RECORDED_READ_SIZES);

  it('has a reason for every check with no independent derivation', () => {
    const unexplained = scripts
      .filter(([script, r]) => r.sources.length === 0 && !(script in READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE))
      .map(([script]) => script);
    expect(unexplained).toEqual([]);
  });

  it('has no reason for a check that reconciles against something', () => {
    const stale = Object.keys(READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE).filter(
      (script) => (RECORDED_READ_SIZES[script]?.sources.length ?? 0) > 0,
    );
    expect(stale).toEqual([]);
  });

  it('has a reason for every check that prints no site count', () => {
    const unexplained = scripts
      .filter(([script, r]) => r.sites === null && !(script in READ_SIZE_WITHOUT_A_SITE_POPULATION))
      .map(([script]) => script);
    expect(unexplained).toEqual([]);
  });

  it('has no reason for a check that prints one', () => {
    const stale = Object.keys(READ_SIZE_WITHOUT_A_SITE_POPULATION).filter(
      (script) => RECORDED_READ_SIZES[script]?.sites !== null,
    );
    expect(stale).toEqual([]);
  });

  it('names only checks that are recorded', () => {
    const unknown = [
      ...Object.keys(READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE),
      ...Object.keys(READ_SIZE_WITHOUT_A_SITE_POPULATION),
    ].filter((script) => !(script in RECORDED_READ_SIZES));
    expect(unknown).toEqual([]);
  });
});
