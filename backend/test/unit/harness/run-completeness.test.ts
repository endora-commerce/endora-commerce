/**
 * A run that did not execute every file it was given says so (issue #199).
 *
 * Pipeline 11478 is the case this is written from. Three of the five
 * `test:backend` shards failed, and two of them reported **no failing test**:
 * shard 4 printed `105 passed | 2 skipped (108)` and shard 5 `45 passed |
 * 2 skipped (47)`, each with a single `Error: Worker exited unexpectedly`. The
 * numbers in those summaries are not a report on the shard — vitest shards by
 * equal file count, so each shard was handed **267** files. Shard 4 ran 108 of
 * them and shard 5 ran 47; the other 159 and 220 never ran, and nothing in the
 * output said so. The reader is left with a green summary and an exit code, and
 * the two disagree.
 *
 * So the count is compared against the count this run was scheduled, and the
 * difference is reported by name. Which list that is is the subtlety, and it
 * has its own describe block at the bottom of this file: `onPathsCollected`
 * carries the whole glob, because vitest applies `--shard` inside the pool,
 * afterwards.
 */
import { describe, expect, it } from 'vitest';

import {
  incompleteRun,
  renderIncompleteRun,
  scheduledForThisRun,
  type ReportedFile,
} from '../../run-completeness.js';

const ROOT = '/builds/monorepo/backend';

function reported(...names: readonly string[]): ReportedFile[] {
  return names.map((name, index) => ({
    filepath: `${ROOT}/${name}`,
    startTime: 1_000 + index,
  }));
}

function scheduled(...names: readonly string[]): string[] {
  return names.map((name) => `${ROOT}/${name}`);
}

describe('incompleteRun', () => {
  it('is null when every scheduled file reported a result', () => {
    expect(
      incompleteRun(scheduled('a.test.ts', 'b.test.ts'), reported('a.test.ts', 'b.test.ts')),
    ).toBeNull();
  });

  it('is null when the run was given nothing — a filter that matched no file is not an incomplete run', () => {
    expect(incompleteRun([], [])).toBeNull();
  });

  it('names the files that never ran, and the last one that did', () => {
    const seen = incompleteRun(
      scheduled('a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'),
      reported('a.test.ts', 'b.test.ts'),
    );

    expect(seen).not.toBeNull();
    expect(seen?.scheduled).toBe(4);
    expect(seen?.reported).toBe(2);
    expect(seen?.missing).toEqual(scheduled('c.test.ts', 'd.test.ts'));
    expect(seen?.lastReported).toBe(`${ROOT}/b.test.ts`);
  });

  /**
   * The order the files finished in is the order the fork ran them, and the
   * last one is the file the diagnosis starts from — not the last one in the
   * scheduled list, which the sequencer reordered by size before the run.
   */
  it('takes the last reported file from the completion order, not the scheduled order', () => {
    const seen = incompleteRun(scheduled('a.test.ts', 'b.test.ts', 'c.test.ts'), [
      { filepath: `${ROOT}/b.test.ts`, startTime: 5_000 },
      { filepath: `${ROOT}/a.test.ts`, startTime: 1_000 },
    ]);

    expect(seen?.lastReported).toBe(`${ROOT}/b.test.ts`);
  });

  it('still answers when no file reported a result at all', () => {
    const seen = incompleteRun(scheduled('a.test.ts'), []);

    expect(seen?.reported).toBe(0);
    expect(seen?.lastReported).toBeNull();
  });

  /**
   * A file with no `startTime` collected but never ran its suites; it is still
   * a reported file as far as the count goes, and it must not be picked as the
   * last one that finished.
   */
  it('ignores a reported file that carries no start time when choosing the last one', () => {
    const seen = incompleteRun(scheduled('a.test.ts', 'b.test.ts', 'c.test.ts'), [
      { filepath: `${ROOT}/a.test.ts`, startTime: 1_000 },
      { filepath: `${ROOT}/b.test.ts`, startTime: null },
    ]);

    expect(seen?.reported).toBe(2);
    expect(seen?.lastReported).toBe(`${ROOT}/a.test.ts`);
  });
});

describe('renderIncompleteRun', () => {
  const run = incompleteRun(
    scheduled('a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'),
    reported('a.test.ts', 'b.test.ts'),
  );

  it('states both counts, so the summary above it cannot be read as a verdict on the shard', () => {
    const text = renderIncompleteRun(run!, ROOT, []);

    expect(text).toContain('4 test files');
    expect(text).toContain('2');
    expect(text).toContain('2 never ran');
  });

  it('names the last file that finished and the first that did not, in paths relative to the root', () => {
    const text = renderIncompleteRun(run!, ROOT, []);

    expect(text).toContain('b.test.ts');
    expect(text).toContain('c.test.ts');
    expect(text).not.toContain(ROOT);
  });

  /**
   * The one message the CI log carried in pipeline 11478. Naming it here is
   * what connects the two halves for the next reader: the unhandled error says
   * the worker died, this says what died with it.
   */
  it('reads the worker-exit error back, so the two halves of the failure are in one place', () => {
    const text = renderIncompleteRun(run!, ROOT, ['Error: Worker exited unexpectedly']);

    expect(text).toContain('Worker exited unexpectedly');
    expect(text).toMatch(/heap|memory/i);
  });

  it('does not claim a worker died when the run carried no such error', () => {
    const text = renderIncompleteRun(run!, ROOT, ['AssertionError: expected 1 to be 2']);

    expect(text).not.toContain('Worker exited unexpectedly');
  });

  /**
   * The paragraph above states two causes and cannot choose between them; the
   * kernel can, and `test/oom-evidence.ts` asks it. This is the wiring: the
   * verdict reaches the reader, and — the case that matters — a verdict of
   * "I could not look" adds nothing rather than a reassuring sentence.
   */
  describe('the cgroup verdict', () => {
    const died = ['Error: Worker exited unexpectedly'];

    it('names the host when the counters say the kill came from outside the container', () => {
      const text = renderIncompleteRun(run!, ROOT, died, {
        kind: 'killed',
        kills: 1,
        by: 'host',
        limitBytes: null,
      });

      expect(text).toContain('oom_kill');
      expect(text).toMatch(/host ran out of memory/i);
    });

    it('says so when the counters say no OOM killer was involved', () => {
      const text = renderIncompleteRun(run!, ROOT, died, { kind: 'none' });

      expect(text).toMatch(/no process of this container/i);
    });

    it('adds nothing when there was no cgroup to read — silence is never a verdict', () => {
      const text = renderIncompleteRun(run!, ROOT, died, { kind: 'unreadable' });

      expect(text).not.toContain('oom_kill');
      expect(text).not.toMatch(/no process of this container/i);
    });

    it('adds nothing when the worker did not die, whatever the counters say', () => {
      const text = renderIncompleteRun(run!, ROOT, [], {
        kind: 'killed',
        kills: 1,
        by: 'host',
        limitBytes: null,
      });

      expect(text).not.toContain('oom_kill');
    });
  });

  /** A 220-file list is not a diagnosis; the first few plus a count is. */
  it('truncates the list of files that never ran', () => {
    const many = Array.from({ length: 220 }, (_, i) => `f${String(i)}.test.ts`);
    const big = incompleteRun(scheduled(...many), reported(...many.slice(0, 3)));
    const text = renderIncompleteRun(big!, ROOT, []);

    expect(text).toContain('217 never ran');
    expect(text.split('\n').length).toBeLessThan(40);
    expect(text).toContain('and 207 more');
  });
});

/**
 * The population question, which is where the first version of this reporter
 * was wrong and would have been wrong on **every** shard.
 *
 * Vitest applies `--shard` inside the pool (`sortSpecs` calls
 * `sequencer.shard`), after `onPathsCollected` has already reported the whole
 * glob. Measured on a real `--shard=5/5` run of this suite: 1 337 paths
 * reported to the reporter, 267 files handed to the fork. A comparison against
 * the reported list turns every green shard into a claim that a thousand files
 * never ran, which is a worse lie than the silence this exists to break.
 */
describe('scheduledForThisRun', () => {
  const paths = ['/r/a.test.ts', '/r/b.test.ts', '/r/c.test.ts', '/r/d.test.ts'];

  it('is the collected list when the run is not sharded', async () => {
    await expect(scheduledForThisRun(paths, { config: { root: '/r' } })).resolves.toEqual(paths);
  });

  it("is the sequencer's answer when it is — vitest's own class, not a copy of its algorithm", async () => {
    let sawCtx: unknown = null;
    class FakeSequencer {
      constructor(ctx: unknown) {
        sawCtx = ctx;
      }
      async shard(
        specs: readonly { moduleId: string }[],
      ): Promise<readonly { moduleId: string }[]> {
        return specs.slice(2);
      }
    }
    const ctx = {
      config: { root: '/r', shard: { index: 2, count: 2 }, sequence: { sequencer: FakeSequencer } },
    };

    await expect(scheduledForThisRun(paths, ctx)).resolves.toEqual([
      '/r/c.test.ts',
      '/r/d.test.ts',
    ]);
    expect(sawCtx).toBe(ctx);
  });

  it('answers null — never the unsharded list — when a sharded run names no sequencer', async () => {
    await expect(
      scheduledForThisRun(paths, { config: { root: '/r', shard: { index: 1, count: 5 } } }),
    ).resolves.toBeNull();
  });

  it('answers null when the sequencer throws, rather than reporting a shard it did not compute', async () => {
    class BrokenSequencer {
      async shard(): Promise<readonly { moduleId: string }[]> {
        throw new Error('no');
      }
    }
    await expect(
      scheduledForThisRun(paths, {
        config: {
          root: '/r',
          shard: { index: 1, count: 5 },
          sequence: { sequencer: BrokenSequencer },
        },
      }),
    ).resolves.toBeNull();
  });
});
