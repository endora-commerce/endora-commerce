import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  classifySource,
  collectPerfSources,
  PERF_WEIGHTS,
  readPerfWeights,
} from '../../../scripts/lib/perf-weights.js';
import { readJobs } from '../../helpers/ci-jobs.js';

/**
 * Every backend benchmark is in exactly one tier, and each tier has a job with a
 * timeout somebody chose.
 *
 * ## The defect
 *
 * The nightly's benchmark selection was a hand-written skip list in
 * `.gitlab-ci.yml`, and the comment above it called the remainder *"the nine
 * fast benchmarks"*. Three PIM integrations landed 10 000-record benchmarks
 * after that list was written; none was added, because nothing asked. On
 * 2026-09-09 (pipeline 13444) `test/perf/pim_unopim/import-throughput.test.ts`
 * ran for **2 599 075 ms**, the runner's inherited one-hour wall arrived while
 * `pim_akeneo/full-delivery-apply.perf.ts` was still going, and three files
 * never ran. Zero tests failed and no budget was exceeded — the failure was
 * *capacity*, and the only instrument that saw anything was
 * `test/run-completeness.ts`, after the hour had been spent.
 *
 * A hand-written list of a derived fact (D-100), failing in the direction that
 * costs an hour of a shared runner before anybody learns.
 *
 * ## Why the classification is declared and the membership derived
 *
 * A file's wall clock is a property of running it, not of its source, so it
 * cannot be derived — but *whether every file has been classified* can be, and
 * that is the half that went wrong. So each benchmark declares its own weight
 * with the measurement that decided it, and this file is the two-way
 * reconciliation: a benchmark in neither tier fails here, on every merge
 * request, in `test:backend:unit`, which needs no service and takes seconds.
 *
 * **There is no default weight, deliberately.** Defaulting to `fast` is exactly
 * how a 43-minute benchmark joined the nightly; defaulting to `heavy` would drop
 * a benchmark out of every schedule with nothing said. Both defaults are a green
 * that means "not looking" (issue #113); a refusal is neither.
 *
 * ## Why this is a test and not a `check-*` script
 *
 * `test/unit/scripts/check-read-size.test.ts` spawns every `check-*` script and
 * holds its printed read size to a recorded band. This rule's subject is
 * `backend/test/perf` and the pipeline's own text — the population
 * `gate-coverage.test.ts` and `boot-gate.test.ts` already answer questions over
 * from here — and a second recorded band over 19 files would buy nothing. The
 * derivation itself lives in `backend/scripts/lib/perf-weights.ts` so that the
 * job and this test read one implementation rather than two.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');
const PERF_ROOT = join(BACKEND_ROOT, 'test/perf');
const SELECTION = join(BACKEND_ROOT, 'scripts/perf-selection.ts');

const sources = collectPerfSources(PERF_ROOT, BACKEND_ROOT);
const reading = readPerfWeights(sources);

describe('the perf suite is classified', () => {
  it('found benchmarks to classify at all', () => {
    // The floor, and the one this file would be worthless without: an empty
    // walk classifies nothing and agrees with everything. `test/perf` has held
    // benchmarks since feature 018; a walk that comes back empty is a moved
    // tree, not a tree with nothing in it.
    expect(reading.scanned).toBeGreaterThan(0);
    expect(sources.every((source) => source.path.startsWith('test/perf/'))).toBe(true);
  });

  it('every benchmark declares exactly one weight, with a reason', () => {
    expect(
      reading.findings.map((finding) => `${finding.path} [${finding.kind}] ${finding.detail}`),
    ).toEqual([]);
    expect(reading.files.length).toBe(reading.scanned);
  });

  it('both tiers have members', () => {
    // A tier with nothing in it is a job that measures nothing and passes. If
    // one is ever genuinely empty, the answer is to delete its job, and this
    // case is where that decision surfaces.
    for (const weight of PERF_WEIGHTS) {
      expect(reading.files.filter((file) => file.weight === weight).length).toBeGreaterThan(0);
    }
  });
});

describe('the classifier can go red', () => {
  // Fixtures enter as source text — where a real file's bytes enter — so the
  // classifier under test is the one that runs (issue #130).
  it('refuses a benchmark with no marker', () => {
    const verdict = classifySource('test/perf/x.bench.ts', 'import { it } from "vitest";\n');
    expect(verdict).toMatchObject({ kind: 'undeclared-weight' });
  });

  it('refuses two markers in one file', () => {
    const verdict = classifySource(
      'test/perf/x.bench.ts',
      '// perf-weight: fast — a\n// perf-weight: heavy — b\n',
    );
    expect(verdict).toMatchObject({ kind: 'duplicate-weight' });
  });

  it('refuses a weight it does not recognise', () => {
    const verdict = classifySource('test/perf/x.bench.ts', '// perf-weight: medium — a\n');
    expect(verdict).toMatchObject({ kind: 'unknown-weight' });
  });

  it('refuses a marker with no reason', () => {
    const verdict = classifySource('test/perf/x.bench.ts', '// perf-weight: heavy\n');
    expect(verdict).toMatchObject({ kind: 'weight-without-a-reason' });
  });

  it('accepts the marker inside a documentation block, which is where a header carries it', () => {
    const verdict = classifySource(
      'test/perf/x.bench.ts',
      '/**\n * A benchmark.\n * perf-weight: heavy — 43 min on the runner.\n */\n',
    );
    expect(verdict).toMatchObject({ weight: 'heavy', reason: '43 min on the runner.' });
  });

  it('does not read a marker out of a string literal', () => {
    // This test file itself writes the marker text into strings a dozen times.
    // Requiring a comment leader is what keeps a file that talks about the rule
    // out of the rule's own population.
    const verdict = classifySource(
      'test/perf/x.bench.ts',
      'const example = "perf-weight: heavy — not a declaration";\n',
    );
    expect(verdict).toMatchObject({ kind: 'undeclared-weight' });
  });
});

describe('the selection CLI', () => {
  const run = (...args: string[]): { status: number | null; stdout: string; stderr: string } => {
    const result = spawnSync('node', ['--import', 'tsx', SELECTION, ...args], {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };

  it('prints one tier on stdout and its accounting on stderr', () => {
    const result = run('--weight', 'fast');
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.startsWith('test/perf/'))).toBe(true);
    // Positive selection: what stdout names is exactly the tier, so a heavy file
    // reaching the nightly job would have to be declared fast.
    expect(new Set(lines)).toEqual(
      new Set(reading.files.filter((file) => file.weight === 'fast').map((file) => file.path)),
    );
    expect(result.stderr).toMatch(/^\[perf-selection\] read: files=\d+ fast=\d+ heavy=\d+ /m);
  });

  it('the two tiers partition the suite', () => {
    const fast = run('--weight', 'fast').stdout.trim().split('\n');
    const heavy = run('--weight', 'heavy').stdout.trim().split('\n');
    expect(fast.filter((path) => heavy.includes(path))).toEqual([]);
    expect(new Set([...fast, ...heavy])).toEqual(new Set(sources.map((source) => source.path)));
  });

  it('refuses a weight it was not given, with the "could not read" code', () => {
    expect(run().status).toBe(2);
    expect(run('--weight', 'medium').status).toBe(2);
  });
});

describe('the pipeline runs both tiers, each under a timeout somebody chose', () => {
  const jobs = readJobs(readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8'));

  /**
   * The two jobs, by the weight each passes to the runner script — derived from
   * the pipeline's own text rather than from a list of job names, so a rename
   * is followed and a third tier's job is found by existing.
   */
  const perfJobs = jobs.filter((job) => /perf-backend\.sh/.test(job.script));

  it('the pipeline was parsed at all', () => {
    expect(jobs.length).toBeGreaterThan(10);
    expect(perfJobs.length).toBeGreaterThan(0);
  });

  it('every declared weight is run by a job', () => {
    const covered = new Set(
      perfJobs.flatMap((job) => [...job.script.matchAll(/--weight\s+(\w+)/g)].map((m) => m[1]!)),
    );
    expect([...PERF_WEIGHTS].filter((weight) => !covered.has(weight))).toEqual([]);
  });

  it('each of those jobs declares its own timeout', () => {
    // The inherited default is what turned a capacity problem into an hour of a
    // shared runner and a truncated report. A timeout nobody chose is not a
    // decision, and `timeout:` cannot be set per `rules:` entry — which is why
    // the two tiers are two jobs.
    const without = perfJobs
      .filter((job) => !/^ {2}timeout:\s*\S+/m.test(job.body))
      .map((job) => job.name);
    expect(without).toEqual([]);
  });

  it('no perf job carries a hand-written benchmark path', () => {
    // The regression this whole change is about: a file named in the pipeline is
    // a derived fact written down, and it goes stale in the direction that
    // costs an hour.
    for (const job of perfJobs) {
      expect(job.script).not.toMatch(/test\/perf\/\S+\.(?:bench|perf|test)\.ts/);
    }
  });
});
