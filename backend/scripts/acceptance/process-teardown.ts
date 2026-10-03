/**
 * How an acceptance runner lets go of what it started, and how it ends.
 *
 * Three runners start long-lived layers in a process group of their own —
 * `instance-local-registry.ts`, `separate-components.ts`, `instance-public.ts`
 * — and each carried its own copy of the same `stopGroup`. This is the one
 * copy, and it differs from what it replaces in the four places that copy let a
 * run outlive its verdicts or leave something behind:
 *
 *   * **It asks the group, not the leader.** `pnpm run start` is the leader and
 *     the server is a member. The copy returned as soon as the leader closed,
 *     and returned at once for a leader that had already exited, so a member
 *     that was still shutting down — or never going to — was left running with
 *     this process's stdout and stderr open. Whatever reads those through a
 *     pipe then waits for an end of file that does not come.
 *   * **It waits for the kill to land.** After `SIGKILL` the copy returned
 *     without waiting, so the caller went on to `docker compose down` and to
 *     removing the scratch directory under processes that were still there.
 *   * **It leaves no timer behind.** The copy raced the exit against a
 *     thirty-second `setTimeout` it never cleared, so every stop that succeeded
 *     at once still held the event loop for the rest of those thirty seconds.
 *   * **A group is tracked from the moment it is started**, so an exit path
 *     that never reaches the `finally` — a refusal, an uncaught exception, a
 *     signal — kills it too (`killTrackedGroups`, run on `exit`).
 *
 * `armExitWatchdog` is the other half. These runners end by assigning
 * `process.exitCode` and letting the event loop drain, which is the right way
 * to end — it flushes stdout — and is unbounded: one handle nobody closed and
 * the process stays, verdicts printed, until somebody kills it. The watchdog
 * does not replace the teardown; it bounds what the teardown missed, and it
 * says what that was rather than exiting silently.
 *
 * POSIX only, like the runners: a negative pid addresses a process group.
 */

/* eslint-disable no-console -- CLI: stderr is where a runner says why it ended. */

import type { ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/** What became of the group. */
export type StopOutcome =
  /** Nothing was left in the group to stop. */
  | 'not-running'
  /** Every member left within the grace period. */
  | 'exited'
  /** The grace period ran out and `SIGKILL` emptied the group. */
  | 'killed'
  /** Something was still there after `SIGKILL` and `killWaitMs` — nothing more can be done from here. */
  | 'survived';

export interface StopOptions {
  /** The polite signal. `SIGINT` is what a terminal sends and what `pnpm run` waits its script out on. */
  readonly signal?: NodeJS.Signals;
  /** How long the group has to leave on the polite signal. */
  readonly graceMs?: number;
  /** How long to wait for `SIGKILL` to empty the group. */
  readonly killWaitMs?: number;
}

const POLL_MS = 50;
const tracked = new Set<number>();
let exitHookInstalled = false;

/** Whether any process is left in the group `pgid` leads — zombies not yet reaped included. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM: it exists and is not ours to signal. Only ESRCH means empty.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // emptied between the look and the signal
  }
}

async function emptyWithin(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid)) {
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
  return true;
}

/**
 * Stop a process group started with `detached: true`: the polite signal, the
 * grace period, then `SIGKILL` — and an answer only once the group is empty.
 *
 * A leader that has already exited is not a reason to return: its pid stays
 * the group's id for as long as one member is left, and cannot be handed to
 * another process until then.
 */
export async function stopProcessGroup(child: ChildProcess, options: StopOptions = {}): Promise<StopOutcome> {
  const pgid = child.pid;
  if (pgid === undefined) return 'not-running';
  const { signal = 'SIGINT', graceMs = 30_000, killWaitMs = 10_000 } = options;
  try {
    if (!groupAlive(pgid)) return 'not-running';
    signalGroup(pgid, signal);
    if (await emptyWithin(pgid, graceMs)) return 'exited';
    signalGroup(pgid, 'SIGKILL');
    return (await emptyWithin(pgid, killWaitMs)) ? 'killed' : 'survived';
  } finally {
    tracked.delete(pgid);
  }
}

/**
 * `SIGKILL` every tracked group that still has a member, synchronously.
 *
 * What the `exit` hook runs; exported so the test can run it without exiting.
 * `kill` is a seam for that test and nothing else.
 */
export function killTrackedGroups(kill: (pgid: number) => void = (pgid) => signalGroup(pgid, 'SIGKILL')): void {
  for (const pgid of tracked) {
    if (groupAlive(pgid)) kill(pgid);
  }
  tracked.clear();
}

/**
 * Remember a group started with `detached: true`, so that no way this process
 * ends leaves it running. Returns the child, to wrap a `spawn` in place.
 *
 * The first call installs the hooks: `exit` kills what is tracked, and the
 * three signals a person or a CI runner stops a job with become an exit —
 * a detached group is by construction out of reach of a terminal's Ctrl-C, so
 * without this, stopping the runner by hand is what orphans its servers.
 */
export function trackProcessGroup<T extends ChildProcess>(child: T): T {
  if (child.pid !== undefined) tracked.add(child.pid);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', () => killTrackedGroups());
    const numbers = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
    for (const [name, number] of Object.entries(numbers)) {
      process.once(name, () => process.exit(128 + number));
    }
  }
  return child;
}

export interface WatchdogOptions {
  /** How long the event loop has to drain by itself. */
  readonly graceMs?: number;
  readonly exit?: (code: number) => void;
  readonly report?: (line: string) => void;
}

/**
 * Set the exit code and bound how long the event loop may take to honour it.
 *
 * Call it once the teardown is done and the report is printed. A loop that
 * drains exits by itself with `code`, stdout flushed, and the timer — which is
 * unref'd, so it is never what keeps the loop alive — does not fire. A loop
 * that does not drain is reported, by the kind of handle still open, and the
 * process exits with the same `code`: the verdicts decide the colour, never
 * the leak.
 */
export function armExitWatchdog(code: number, options: WatchdogOptions = {}): NodeJS.Timeout {
  const {
    graceMs = 15_000,
    exit = (status: number): void => process.exit(status),
    report = (line: string): void => console.error(line),
  } = options;
  process.exitCode = code;
  const timer = setTimeout(() => {
    const open = process.getActiveResourcesInfo();
    report(
      `[acceptance] still running ${String(graceMs)} ms after the report, held by: ` +
        `${open.length === 0 ? 'nothing the runtime names' : open.join(', ')}. ` +
        `Exiting ${String(code)} — the verdicts decide the code; this leak is a defect in the teardown.`,
    );
    exit(code);
  }, graceMs);
  timer.unref();
  return timer;
}
