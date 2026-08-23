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
 * So the count is compared against the count vitest scheduled, and the
 * difference is reported by name. `onPathsCollected` receives the sharded spec
 * list — the same list `--shard` produced — so this is the run's own view of
 * what it was asked to do, not a second derivation of it.
 */
import { describe, expect, it } from 'vitest';

import {
  incompleteRun,
  renderIncompleteRun,
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
