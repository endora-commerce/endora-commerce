import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseReadSize, type ParsedReadSize } from '../../../scripts/lib/read-size.js';
import {
  reachedItsOwnVerdict,
  spawnCheck,
  terminationReport,
  type SpawnedCheck,
} from '../../helpers/check-process.js';
import { explainPool, observedPoolInputs, spawnPoolSize } from '../../helpers/spawn-pool.js';
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
 * `test/helpers/check-read-sizes.ts`. Four things are asserted, and they fail
 * for four different reasons:
 *
 *   1. **The child reached a verdict of its own.** A process the kernel killed
 *      printed nothing for a reason that is not the check's, and the two must
 *      not read the same: one sends the reader into the analysis, the other to
 *      what the run was executed inside.
 *   2. **The line exists.** A check that discloses nothing is a check whose
 *      green cannot be told from a check that read nothing — the whole family.
 *   3. **The numbers are in band.** Materially fewer files or sites than
 *      recorded is the defect direction; materially more is a recorded number
 *      that has gone stale and stopped meaning anything. The band and the
 *      reasoning behind its two edges are in the helper.
 *   4. **The corroboration is the one recorded, and it holds.** A check that
 *      computes its own population and reports it has not closed #215 — that is
 *      the same value twice. Where an independent derivation exists the run
 *      must still name it *and* cover it in full; where none exists the record
 *      says so and `READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE` carries the
 *      reason, so "self-reported" is a statement rather than a silence.
 *
 * It spawns one process per recorded check over the whole repository, which is
 * why it lives in its own file rather than inside the inventory: the inventory
 * is pure and fast, and a developer runs it constantly.
 *
 * **A killed child is not a silent one.** Every spawn goes through
 * `test/helpers/check-process.ts`, which keeps the `close` event's two answers
 * apart: a non-zero exit is tolerated on purpose (a check may legitimately be
 * red on the working tree, and it still has to disclose what it read), while a
 * termination by *signal* is a resource failure of whatever the run is inside
 * and is reported as one. It was not, and the disguise cost a CI investigation:
 * the two heaviest checks were OOM-killed on the 4 GB runner and reported as
 * `printed no read line`.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');

/**
 * Long enough for the whole sweep at a pool of **one**, which is a legal
 * outcome of the derivation below on a tight container.
 *
 * Measured 2026-08-24 on a 16-core developer box: the estate takes 220 s end to
 * end when run strictly one at a time. A 4 vCPU runner is slower per check, so
 * this leaves a wide margin rather than a tight one — a hook timeout that
 * expires reports as "the checks did not print", which is the very confusion
 * this file has just been repaired of.
 */
const SPAWN_TIMEOUT_MS = 900_000;

/**
 * Peak resident cost of one spawned check, and the divisor the pool is sized
 * with.
 *
 * Measured on 2026-08-24, per process tree, sampled every 100 ms, summing PSS
 * so pages shared between the children are not counted twice — and measured one
 * check at a time, because several agents run on this machine and any
 * whole-machine sampling would have been somebody else's memory. The estate:
 *
 *   * the 26 `tsx` checks peak between 274 MB and **746 MB**, median 573 MB;
 *   * the 3 shell scans peak under 12 MB — they are `grep` and `perl`, not a
 *     TypeScript program;
 *   * `check-port-catches` (746 MB) and `check-port-shape` (627 MB) are the
 *     first and third heaviest, and they are exactly the two the runner killed.
 *
 * `files=` is not a proxy for this and the numbers say so plainly:
 * `check-nul-bytes` opens 5470 files for 364 MB, `check-port-catches` opens
 * 1541 for 746 MB. What costs memory is the TypeScript program, not the walk.
 *
 * 800 MB is the worst observed (778 MB on a second run of the heaviest) rounded
 * up. Re-measure it when the tree grows; it is a measurement, not a budget.
 */
const PEAK_BYTES_PER_CHECK = 800 * 1024 * 1024;

/**
 * How many checks run at once — derived, never chosen.
 *
 * `test/helpers/spawn-pool.ts` takes the minimum of the cores this process may
 * use and what the container will still give it, holding one child's worth
 * back. This used to be the literal `8`, chosen when nothing limited the
 * container: eight of the heaviest at 746 MB is 5.8 GB, which is why a 4 GB
 * runner killed two of them.
 *
 * What it trades: a smaller pool is a longer sweep and nothing else — the
 * checks share no state. {@link SPAWN_TIMEOUT_MS} covers the sequential case.
 */
const POOL_INPUTS = observedPoolInputs(PEAK_BYTES_PER_CHECK);
const CONCURRENCY = spawnPoolSize(POOL_INPUTS);
const POOL_NOTE = explainPool(POOL_INPUTS, CONCURRENCY);

interface Observed extends SpawnedCheck {
  readonly read: ParsedReadSize | null;
}

const observed = new Map<string, Observed>();

async function observe(script: string, recorded: RecordedReadSize): Promise<void> {
  const { kind, path, args } = recorded.run;
  const command = kind === 'tsx' ? 'pnpm' : 'bash';
  const argv = kind === 'tsx' ? ['exec', 'tsx', path, ...args] : [path, ...args];
  const cwd = kind === 'tsx' ? BACKEND_ROOT : REPO_ROOT;
  const seen = await spawnCheck(command, argv, { cwd });
  observed.set(script, { ...seen, read: parseReadSize(seen.output) });
}

beforeAll(async () => {
  // Printed on every run, not only on a failing one, in the idiom this whole
  // file exists for: a pool that silently derived 1 — or 16 — would otherwise
  // be visible as nothing but a job that got slower, or a runner that died
  // again. `warn` because that is where the harness's own lines go.
  console.warn(POOL_NOTE);
  // Declaration order, deliberately. With the pool sized against the *heaviest*
  // child, no ordering of the queue can exceed the budget, so ordering is a
  // makespan question alone — and at these pool sizes it is worth a few seconds
  // of a two-minute sweep. Scheduling the heavy ones first would need a cost
  // per check, and the one number this file already has (`files`) does not
  // predict cost at all: see PEAK_BYTES_PER_CHECK. A second recorded number,
  // kept true by nobody, would buy that handful of seconds.
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
      it('ran to a verdict of its own', () => {
        const seen = observed.get(script);
        expect(seen, `${script} was never spawned`).toBeDefined();
        // Not a claim about the check's colour: exit 1 is a verdict. This is
        // the claim that the process was allowed to reach one at all, and it
        // is the assertion a SIGKILL belongs to — every test below would
        // otherwise report a resource failure as missing content.
        expect(
          reachedItsOwnVerdict(seen),
          `${terminationReport(script, seen)}\n\n${POOL_NOTE}`,
        ).toBe(true);
      });

      it('prints a read line', () => {
        const seen = observed.get(script);
        // Reported by the test above, in the words that send the reader to the
        // runner rather than to the check.
        if (!reachedItsOwnVerdict(seen)) return;
        expect(seen?.read, terminationReport(script, seen)).not.toBeNull();
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
