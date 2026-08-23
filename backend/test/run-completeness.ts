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
 * `onPathsCollected` is handed the spec list **after** sharding and filtering —
 * it is the run's own answer to "what was I asked to do" — so comparing it with
 * the files that reported a result needs no second derivation of the population
 * and cannot drift from `--shard`.
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
  private scheduled: readonly string[] = [];
  private root = process.cwd();
  private write: (text: string) => void = (text) => process.stderr.write(text);

  onInit(ctx: { config?: { root?: string } }): void {
    this.root = ctx.config?.root ?? process.cwd();
  }

  onPathsCollected(paths?: string[]): void {
    this.scheduled = paths ?? [];
  }

  onFinished(files: readonly { filepath: string; result?: { startTime?: number } }[] = [], errors: readonly unknown[] = []): void {
    const run = incompleteRun(
      this.scheduled,
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
