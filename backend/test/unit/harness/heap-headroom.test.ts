/**
 * The fork says how close it is to its heap limit before it dies of it
 * (issue #199).
 *
 * The whole backend suite runs in **one** process (`poolOptions.forks.singleFork`),
 * and CI caps that process's old-space at 2 GB. When the run's live set reaches
 * the cap the process dies, and it dies in one of two ways, neither of which
 * names a file: V8 prints `FATAL ERROR: ... JavaScript heap out of memory` and
 * aborts, or the host kills it and prints nothing. Either way vitest sees only
 * `Error: Worker exited unexpectedly`, and every file after that point silently
 * does not run.
 *
 * `test/integration/kernel/heap-ceiling.test.ts` was written to turn exactly
 * that into a legible assertion and cannot: its `LIVE_SET_CEILING_MB` is 3072,
 * which is **above** the 2048 the job gives the process, so the fork always dies
 * first; and it is one file, so it guards only the shard it is sharded into —
 * in pipeline 11478 that was shard 2, while shards 3, 4 and 5 were the ones that
 * died. Both limitations follow from where the number lives, so the reading
 * moves to a setup file (every file in every shard) and the ceiling is derived
 * from `v8.getHeapStatistics().heap_size_limit` — the limit this process
 * actually has, whatever `NODE_OPTIONS` says.
 */
import { describe, expect, it } from 'vitest';

import { heapVerdict, renderHeapCrossing, WARN_FRACTION, FAIL_FRACTION } from '../../heap-headroom.js';

const LIMIT = 2048 * 1024 * 1024;

describe('heapVerdict', () => {
  it('says nothing while the reading is below the warning line', () => {
    expect(heapVerdict({ heapUsedBytes: LIMIT * 0.5, heapLimitBytes: LIMIT, collected: false }).kind).toBe(
      'quiet',
    );
  });

  /**
   * A raw reading over the line is garbage plus live data and cannot be judged;
   * the caller is told to collect and read again. That is what keeps the
   * forced GC off the hot path — it is paid only once the run is genuinely
   * close.
   */
  it('asks for a forced collection when an uncollected reading crosses the warning line', () => {
    expect(
      heapVerdict({ heapUsedBytes: LIMIT * (WARN_FRACTION + 0.01), heapLimitBytes: LIMIT, collected: false })
        .kind,
    ).toBe('collect');
  });

  it('reports a crossing when the post-collection live set is over the warning line but under the failing one', () => {
    const seen = heapVerdict({
      heapUsedBytes: LIMIT * ((WARN_FRACTION + FAIL_FRACTION) / 2),
      heapLimitBytes: LIMIT,
      collected: true,
    });

    expect(seen.kind).toBe('report');
  });

  it('fails when the post-collection live set is over the failing line', () => {
    const seen = heapVerdict({
      heapUsedBytes: LIMIT * (FAIL_FRACTION + 0.01),
      heapLimitBytes: LIMIT,
      collected: true,
    });

    expect(seen.kind).toBe('fail');
  });

  /**
   * Without `--expose-gc` there is no way to separate live data from garbage,
   * so the reading may not be failed on — an uncollected heap sitting at 95%
   * is an ordinary state for a process that has not been asked to collect.
   * It is still worth reporting, because the trajectory is the diagnosis.
   */
  it('never fails on a reading it could not collect first', () => {
    expect(
      heapVerdict({ heapUsedBytes: LIMIT * 0.99, heapLimitBytes: LIMIT, collected: false, canCollect: false })
        .kind,
    ).toBe('report');
  });

  it('is quiet when the limit is unknown, rather than dividing by zero', () => {
    expect(heapVerdict({ heapUsedBytes: LIMIT, heapLimitBytes: 0, collected: true }).kind).toBe('quiet');
  });

  it('orders its two lines — a reading cannot be both a report and a failure', () => {
    expect(FAIL_FRACTION).toBeGreaterThan(WARN_FRACTION);
    expect(FAIL_FRACTION).toBeLessThan(1);
  });
});

describe('renderHeapCrossing', () => {
  const text = renderHeapCrossing(
    { heapUsedBytes: 1_800 * 1024 * 1024, heapLimitBytes: LIMIT, collected: true },
    'test/integration/orders/place-order.test.ts',
  );

  it('gives both numbers and the percentage, because drift is only readable against them', () => {
    expect(text).toContain('1800');
    expect(text).toContain('2048');
    expect(text).toContain('88%');
  });

  it('names the file the reading was taken after', () => {
    expect(text).toContain('place-order.test.ts');
  });

  it('says the number belongs to the run and not to that one file', () => {
    expect(text).toMatch(/whole run|run's|shares one/i);
  });
});
