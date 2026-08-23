/**
 * The run reports on every file it was given — or says which ones it did not
 * reach (issue #199).
 *
 * ## The failure this exists for
 *
 * A vitest run whose worker process dies mid-run does not report the files it
 * never got to. `pool.run` rejects, the rejection is recorded as an unhandled
 * error, and the summary counts only the files that produced a result. In
 * pipeline 11478 that produced two jobs whose logs read
 *
 *     Test Files  105 passed | 2 skipped (108)
 *          Tests  1164 passed | 8 skipped (1177)
 *         Errors  1 error
 *
 * against a shard vitest had handed **267** files. 159 of them never ran, the
 * summary said nothing about them, and the only evidence was a single
 * `Error: Worker exited unexpectedly` with no stack into this repository. A job
 * that fails with no failing test is the worst diagnostic there is: the reader
 * has to disbelieve the summary before they can start.
 *
 * The population is the run's own — `onPathsCollected` is what vitest itself
 * globbed and filtered — with one correction that is easy to get wrong and was:
 * the shard is applied **inside the pool**, after that hook, so on a
 * `--shard` run the reported list is the whole suite. See
 * {@link scheduledForThisRun}.
 *
 * ## What it does not claim
 *
 * It says a file produced no result. It does not say why, and it cannot: the
 * fork is gone by the time this runs. `test/heap-headroom.ts` is the other half
 * — it runs *inside* the fork and names the heap trajectory while the fork is
 * still alive, so between them the commonest cause arrives with a number
 * attached instead of as a silent `SIGKILL`.
 */
import { relative } from 'node:path';

import type { Reporter } from 'vitest/reporters';

/** A file vitest reported a result for. `startTime` is null when it collected but never ran. */
export interface ReportedFile {
  readonly filepath: string;
  readonly startTime: number | null;
}

export interface IncompleteRun {
  /** Files the run was given, after `--shard` and any name filter. */
  readonly scheduled: number;
  /** Files that produced a result. */
  readonly reported: number;
  /** Absolute paths of the files that produced none, in scheduled order. */
  readonly missing: readonly string[];
  /** Absolute path of the last file to start, or null when none did. */
  readonly lastReported: string | null;
}

/** How many missing files the report names before it summarises the rest. */
const NAMED_MISSING_FILES = 10;

const WORKER_EXIT = 'Worker exited unexpectedly';

export function incompleteRun(
  scheduled: readonly string[],
  reported: readonly ReportedFile[],
): IncompleteRun | null {
  if (scheduled.length === 0) return null;

  const done = new Set(reported.map((file) => file.filepath));
  const missing = scheduled.filter((path) => !done.has(path));
  if (missing.length === 0) return null;

  let last: ReportedFile | null = null;
  for (const file of reported) {
    if (file.startTime === null) continue;
    if (last === null || file.startTime > (last.startTime ?? -1)) last = file;
  }

  return {
    scheduled: scheduled.length,
    reported: reported.length,
    missing,
    lastReported: last?.filepath ?? null,
  };
}

export function renderIncompleteRun(
  run: IncompleteRun,
  root: string,
  unhandledErrors: readonly string[],
): string {
  const rel = (path: string): string => relative(root, path) || path;
  const workerDied = unhandledErrors.some((message) => message.includes(WORKER_EXIT));

  const lines: string[] = [
    '',
    '⎯⎯⎯⎯⎯⎯ Incomplete run ⎯⎯⎯⎯⎯⎯',
    '',
    `This run was given ${String(run.scheduled)} test files and reported a result for ` +
      `${String(run.reported)}. ${String(run.missing.length)} never ran, so the pass/fail ` +
      'counts printed above describe part of this shard and say nothing at all about the rest.',
    '',
  ];

  if (workerDied) {
    lines.push(
      `The worker process ended before the run did — that is the \`${WORKER_EXIT}\` error ` +
        'above, and it carries no stack into this repository because there is none to carry: ' +
        'the process is simply gone. The two causes seen in this suite are the fork exhausting ' +
        'its V8 old-space (which prints `FATAL ERROR: ... JavaScript heap out of memory` just ' +
        'before it dies) and the host killing it for memory (which prints nothing at all). ' +
        '`test/heap-headroom.ts` reports the live set of every file that crosses its warning ' +
        'line, so the last such line in this log is where the trajectory was going.',
      '',
    );
  }

  lines.push(
    `  last file that finished   ${run.lastReported === null ? '(none)' : rel(run.lastReported)}`,
    `  first file that did not   ${rel(run.missing[0] ?? '')}`,
  );

  for (const path of run.missing.slice(1, NAMED_MISSING_FILES)) {
    lines.push(`                            ${rel(path)}`);
  }
  if (run.missing.length > NAMED_MISSING_FILES) {
    lines.push(
      `                            … and ${String(run.missing.length - NAMED_MISSING_FILES)} more`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * The narrow slice of vitest a reporter needs to reproduce a shard.
 *
 * `sequencer` is `unknown` rather than a constructor type on purpose: vitest's
 * `TestSequencerConstructor` takes a `Vitest` and returns a `TestSequencer`
 * whose `shard` takes a **mutable** `WorkspaceSpec[]`, and writing either of
 * those here makes `Vitest` stop being assignable to this shape — a structural
 * mismatch over a value this file only ever forwards. It is narrowed at the
 * call site instead, where a failed narrowing has a defined answer (`null`,
 * said out loud) rather than a compile error over an interface nobody reads.
 */
interface VitestLike {
  readonly config?: {
    readonly root?: string;
    readonly shard?: { readonly index: number; readonly count: number };
    readonly sequence?: { readonly sequencer?: unknown };
  };
}

/** What {@link scheduledForThisRun} asks of whatever the config named. */
type SequencerLike = { shard?: (specs: { moduleId: string }[]) => unknown };

/**
 * The files **this** run was given, which on a `--shard` run is not the list
 * `onPathsCollected` carries.
 *
 * Vitest applies the shard **inside the pool** — `sortSpecs` calls
 * `sequencer.shard(specs)` in `createPool`'s `runTests`, well after
 * `onPathsCollected` has reported the whole glob. Measured: a real
 * `--shard=5/5` run reports 1 337 paths to a reporter and hands 267 files to the
 * fork. Comparing against the wrong one turns every green shard into a report
 * of a thousand files that "never ran", which is a worse lie than the silence
 * this exists to break.
 *
 * So the shard is reproduced with **vitest's own sequencer**, the class its
 * resolved config names, rather than with a second copy of the algorithm here.
 * `BaseSequencer.shard` reads `spec.moduleId` and `config.root` and returns the
 * specs it kept, which is why a `{ moduleId }` stands in for a spec.
 *
 * Returns `null` when the run is sharded and the shard could not be reproduced
 * — a custom sequencer, or a vitest whose config no longer names one. Saying
 * nothing is the only safe answer there, and it is said out loud rather than
 * dropped.
 */
export async function scheduledForThisRun(
  collected: readonly string[],
  ctx: VitestLike,
): Promise<readonly string[] | null> {
  const shard = ctx.config?.shard;
  if (shard === undefined) return collected;

  const Sequencer = ctx.config?.sequence?.sequencer;
  if (typeof Sequencer !== 'function') return null;

  try {
    const construct = Sequencer as new (ctx: VitestLike) => SequencerLike;
    const sequencer = new construct(ctx);
    if (typeof sequencer.shard !== 'function') return null;

    const kept = await sequencer.shard(collected.map((moduleId) => ({ moduleId })));
    if (!Array.isArray(kept)) return null;

    return (kept as readonly { moduleId?: unknown }[]).map((spec) => String(spec.moduleId));
  } catch {
    return null;
  }
}

/**
 * Wires the comparison to vitest.
 *
 * It sets `process.exitCode` itself rather than relying on the unhandled error
 * to do it. That is not redundancy for its own sake: `dangerouslyIgnoreUnhandledErrors`
 * is one line away in `vitest.shared.ts` (it is commented out there, with
 * "last resort" beside it), and with it set a dead worker would make this job
 * **green** with two hundred files unrun. A run that did not execute what it
 * was given is a failed run whatever else the configuration says.
 */
export class RunCompletenessReporter implements Reporter {
  private collected: readonly string[] = [];
  private ctx: VitestLike = {};
  private root = process.cwd();
  private write: (text: string) => void = (text) => process.stderr.write(text);

  onInit(ctx: VitestLike): void {
    this.ctx = ctx;
    this.root = ctx.config?.root ?? process.cwd();
  }

  onPathsCollected(paths?: string[]): void {
    this.collected = paths ?? [];
  }

  async onFinished(
    files: readonly { filepath: string; result?: { startTime?: number } }[] = [],
    errors: readonly unknown[] = [],
  ): Promise<void> {
    const scheduled = await scheduledForThisRun(this.collected, this.ctx);
    if (scheduled === null) {
      this.write(
        '\n[run-completeness] this run is sharded and its sequencer is not one this reporter ' +
          'can reproduce, so it cannot say whether every file of the shard ran (issue #199). ' +
          'See backend/test/run-completeness.ts.\n',
      );
      return;
    }

    const run = incompleteRun(
      scheduled,
      files.map((file) => ({
        filepath: file.filepath,
        startTime: file.result?.startTime ?? null,
      })),
    );
    if (run === null) return;

    this.write(
      renderIncompleteRun(
        run,
        this.root,
        errors.map((error) => (error instanceof Error ? error.message : String(error))),
      ),
    );
    process.exitCode = 1;
  }
}
