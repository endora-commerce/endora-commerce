/**
 * The fork's distance from its own heap limit, read once per test file
 * (issue #199).
 *
 * ## Why this is a setup file and not a test
 *
 * The whole backend suite runs in one process — `poolOptions.forks.singleFork`
 * puts every file of a shard into a single `pool.run`, so the fork is recycled
 * once, at the end — and CI caps that process's old-space at 2 GB. When the
 * run's live set reaches the cap the process dies with `FATAL ERROR: ...
 * JavaScript heap out of memory`, or the host kills it and it dies silently;
 * vitest sees `Error: Worker exited unexpectedly` either way, every remaining
 * file silently does not run, and the summary reports the files that did as
 * green. That is pipeline 11478, on three shards out of five.
 *
 * `test/integration/kernel/heap-ceiling.test.ts` exists to turn that into an
 * assertion and cannot, for two reasons that are both about being a test file:
 * its ceiling is a constant (3072 MB) set against a 4 GB old-space limit that
 * this job does not give the process, so the fork dies 1 GB before the tripwire;
 * and a file only runs in the shard it is sharded into, which in 11478 was
 * shard 2 — one of the two that survived. A setup file runs before every file
 * of every shard, and `v8.getHeapStatistics().heap_size_limit` is the limit this
 * process really has, so neither mistake is available here.
 *
 * ## What it costs
 *
 * A `process.memoryUsage()` call per test file, which is free. The forced
 * collection — the only expensive part, and the only way to tell live data from
 * garbage — happens only once a raw reading has already crossed the warning
 * line, which on a healthy run never happens. `--expose-gc` reaches the fork
 * through `poolOptions.forks.execArgv` (it is there for the heap-ceiling test);
 * where it is absent the reading is still reported and is never failed on,
 * because an uncollected heap near the limit is an ordinary state for a process
 * nobody has asked to collect.
 */
import { getHeapStatistics } from 'node:v8';

import { afterAll } from 'vitest';

/**
 * Above this fraction of the limit the run is close enough that the number is
 * worth printing, and worth paying a collection to make it meaningful.
 */
export const WARN_FRACTION = 0.8;

/**
 * Above this fraction — **after** a forced collection, so it is live data — the
 * run is failed. V8's own death spiral starts here: the last mark-compacts in
 * both pipeline 11478 and the local reproduction ran at 97–98% of the limit and
 * freed under 10 MB each. Failing at 0.9 buys a named file and a number in
 * exchange for a run that had a few files left to live.
 */
export const FAIL_FRACTION = 0.9;

const MB = 1024 * 1024;

export interface HeapReading {
  readonly heapUsedBytes: number;
  readonly heapLimitBytes: number;
  /** Whether a full collection ran immediately before this reading. */
  readonly collected: boolean;
  /** Whether a full collection is available at all (`--expose-gc`). */
  readonly canCollect?: boolean;
}

export type HeapVerdict =
  | { readonly kind: 'quiet' }
  /** Over the warning line but not yet collected — collect and ask again. */
  | { readonly kind: 'collect' }
  /** Worth printing: close to the limit, and this is the live set. */
  | { readonly kind: 'report'; readonly fraction: number }
  /** Live data over the failing line: the run is about to die of it. */
  | { readonly kind: 'fail'; readonly fraction: number };

/**
 * The two lines, overridable — not as an operator knob, but so that the guard
 * can be **seen to fire**. `heap-headroom.test.ts` spawns a real vitest run
 * whose setup file arms it at fractions a healthy process crosses immediately,
 * and asserts the message and the non-zero exit. A guard nothing has ever seen
 * refuse anything is what `heap-ceiling.test.ts` had become; the whole point of
 * this file is not to become the same thing.
 */
export interface HeapFractions {
  readonly warn?: number;
  readonly fail?: number;
}

export function heapVerdict(reading: HeapReading, fractions: HeapFractions = {}): HeapVerdict {
  if (reading.heapLimitBytes <= 0) return { kind: 'quiet' };

  const warn = fractions.warn ?? WARN_FRACTION;
  const fail = fractions.fail ?? FAIL_FRACTION;
  const fraction = reading.heapUsedBytes / reading.heapLimitBytes;
  if (fraction < warn) return { kind: 'quiet' };

  const canCollect = reading.canCollect ?? true;
  if (!reading.collected && canCollect) return { kind: 'collect' };
  if (reading.collected && fraction >= fail) return { kind: 'fail', fraction };
  return { kind: 'report', fraction };
}

export function renderHeapCrossing(reading: HeapReading, file: string): string {
  const used = Math.round(reading.heapUsedBytes / MB);
  const limit = Math.round(reading.heapLimitBytes / MB);
  const percent = Math.round((reading.heapUsedBytes / reading.heapLimitBytes) * 100);
  const qualifier = reading.collected ? 'live set' : 'heap (not collected)';

  return (
    `[heap-headroom] ${qualifier} ${String(used)} MB of a ${String(limit)} MB limit ` +
    `(${String(percent)}%) after ${file}. The whole shard shares one process, so this is ` +
    `the run's number and not that file's — it is where the trajectory had got to when ` +
    `that file finished.`
  );
}

function forceCollection(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== 'function') return false;
  gc();
  return true;
}

function read(collected: boolean, canCollect: boolean): HeapReading {
  return {
    heapUsedBytes: process.memoryUsage().heapUsed,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    collected,
    canCollect,
  };
}

/**
 * Registered from a setup file, so it runs once per test file, after that
 * file's suites.
 */
export function watchHeapHeadroom(fractions: HeapFractions = {}): void {
  afterAll((suite: { name?: string }) => {
    const canCollect = typeof (globalThis as { gc?: () => void }).gc === 'function';
    let reading = read(false, canCollect);
    let verdict = heapVerdict(reading, fractions);

    if (verdict.kind === 'collect') {
      forceCollection();
      reading = read(true, canCollect);
      verdict = heapVerdict(reading, fractions);
    }

    if (verdict.kind === 'quiet') return;

    const line = renderHeapCrossing(reading, suite.name ?? '(unknown file)');
    if (verdict.kind === 'report') {
      process.stderr.write(`${line}\n`);
      return;
    }

    throw new Error(
      `${line}\n` +
        'Failing here rather than letting the process die: past this point V8 spends the ' +
        'run in mark-compacts that free nothing, and when it gives up the fork disappears ' +
        'with no failing test and every remaining file of the shard silently unrun (issue ' +
        '#199). The number above is the run\'s live set, so the repair is a retention the ' +
        'run does not need, not this file. `test/integration/kernel/heap-ceiling.test.ts` ' +
        'measures per-composition retention and is the instrument for that.',
    );
  });
}
