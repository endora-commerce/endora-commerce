/**
 * Spawning a check, keeping the one distinction the caught error threw away —
 * and keeping it at the layer the tree actually spawns at.
 *
 * ## Why this exists
 *
 * `test/unit/scripts/check-read-size.test.ts` spawns every recorded check
 * and asserts each prints its `read:` line. It tolerates a **non-zero exit**
 * deliberately — a check may legitimately be red on the working tree, and it
 * still has to disclose what it read — and that tolerance used to swallow
 * something it was never meant to cover: a child **killed by a signal**. On the
 * dedicated CI runner (4 GB container) the two heaviest checks were SIGKILLed
 * by the OOM killer before writing a byte, and the run reported them exactly as
 * it would report a check that had run to completion and printed nothing:
 *
 * ```
 * backend/scripts/check-port-catches.ts printed no read line. Its output was:
 * ```
 *
 * A content-shaped assertion for a resource failure: the job exits 1 rather
 * than 137, the message sends the reader into the check's analysis, and nobody
 * grepping the log for an OOM matches a line. **A killed check is
 * indistinguishable from a silent one** — which is issue #244's own defect
 * shape, one layer out: the output said what it found and never said what
 * happened to it.
 *
 * The kernel had the discrimination all along. A process terminated by a signal
 * closes with `signal` set and a `null` exit code; a process that ran and
 * printed nothing closes with a number. `child_process.spawn` hands both to the
 * `close` event, so this helper keeps them apart instead of collapsing them
 * into one caught error — which is what `promisify(execFile)` did, and what any
 * spawning test written in that idiom will do next.
 *
 * ## Why that was not enough, which is the repair this file now carries
 *
 * `signal !== null` is the right discrimination **for a direct child**, and the
 * caller spawns no direct child. Measured on this tree, `spawn('pnpm', ['exec',
 * 'tsx', …])` nests three deep:
 *
 * ```
 * pnpm exec tsx scripts/check-port-shape.ts      <- the direct child
 *   node .../tsx/dist/cli.mjs scripts/…          <- tsx's own launcher
 *     node --require .../preflight.cjs …         <- the TypeScript program
 * ```
 *
 * The last one is the one that holds the program and the one the OOM killer
 * takes. Its two ancestors **survive**, observe a child that died on a signal,
 * and each report it the way POSIX has always reported it — by exiting
 * `128 + signum` themselves. So the parent's `close` event carries
 * `code: 137, signal: null`, the discrimination above never fires, and
 * scheduled pipeline 13573 printed
 *
 * ```
 * backend/scripts/check-port-shape.ts exited 137 and printed no read line
 *   — it ran to a verdict of its own, so this is the check's behaviour.
 * ```
 *
 * over a process the kernel had killed. The repair was right one layer in and
 * the tree spawns one layer out. Verified rather than reasoned: a child that
 * does nothing but `process.kill(process.pid, 'SIGKILL')`, run through
 * `pnpm exec tsx`, closes `{ code: 137, signal: null }`.
 *
 * ## How a relayed kill is recognised, and why not by the number
 *
 * Two questions, two sources, and keeping them apart is the whole design:
 *
 *   * **Was it a signal at all?** `128 + signum` is the convention every
 *     relaying layer in that stack implements — a POSIX shell's `$?`, `pnpm`,
 *     `tsx`. The signal number is turned back into a name through Node's own
 *     `os.constants.signals`, so nothing here writes `137`, `9` or `SIGKILL`
 *     down: un-map the table and the reading follows it. It is still a
 *     *convention*, which is why it is reported as a relay rather than as a
 *     kill this process witnessed, and why the message names the one reading it
 *     can be wrong about — a check that exits `128 + n` as a verdict of its own.
 *     No check in this estate does; they exit 0, 1 and 2, and 2 is the estate's
 *     "nothing was read".
 *   * **Was it memory?** That the kernel answers, and it has been answering all
 *     along in the container's own cgroup counters. `test/oom-evidence.ts` is
 *     what reads them — for the suite's own verdict in `test/run-completeness.ts`
 *     — and it is asked here too rather than a second time in a second way: the
 *     baseline is taken before the spawn and the delta after the close, so the
 *     verdict covers the window this child was alive for.
 *
 * The convention decides *that it was a signal*; the kernel decides *whether it
 * was memory*. Neither can answer the other's question, and an external
 * `kill -9` — a CI timeout, a supervisor — is the case that proves it: the
 * relay says signal, the counters say not memory, and both are right.
 *
 * What the cgroup reading cannot do is attribute a kill to *this* child. The
 * counters are the container's and the caller runs a pool, so the sentence
 * below says what the counter says — an OOM killer took `n` processes of this
 * container while this check was running — and never that it took this one.
 *
 * ## Why `spawn` and not `execFile`
 *
 * `execFile` reports a signal on its error object too, but it also *sends* one:
 * exceeding `maxBuffer` kills the child with `SIGTERM` and a `timeout` does the
 * same, so a caller reading `error.signal` cannot tell an external kill from
 * one `execFile` itself delivered. Reading the `close` event of a `spawn` has no
 * such ambiguity — nothing in this file kills anything — and it removes
 * `maxBuffer` as a failure mode: output is capped here, with the **full** byte
 * count kept, because "how much had it printed before it died" is part of the
 * diagnosis.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';

import {
  oomVerdict,
  readCgroupMemory,
  type CgroupMemory,
  type OomVerdict,
} from '../oom-evidence.js';

/** How the child stopped. Exactly one of the four, never inferred. */
export type CheckTermination =
  /** It reached a verdict of its own and exited with this code. */
  | { readonly kind: 'exit'; readonly code: number }
  /** It was terminated from outside, before any verdict of its own. */
  | { readonly kind: 'signal'; readonly signal: string }
  /**
   * A surviving wrapper reported that *its* child was terminated from outside,
   * by exiting `128 + signum`. The process that did the work is one or more
   * layers in; this is the only shape its death can reach the caller in.
   */
  | { readonly kind: 'relayed-signal'; readonly code: number; readonly signal: string }
  /** It never started: the command could not be spawned at all. */
  | { readonly kind: 'unspawned'; readonly reason: string };

export interface SpawnedCheck {
  /** stdout and stderr interleaved, truncated at {@link OUTPUT_CAP}. */
  readonly output: string;
  /** Everything the child wrote, whether or not it survived the cap. */
  readonly bytes: number;
  readonly termination: CheckTermination;
  /**
   * What this container's cgroup counted while the child was alive, from
   * `test/oom-evidence.ts`. `unreadable` off a container, and a verdict about
   * the **container** rather than about this child — see the header.
   */
  readonly oom: OomVerdict;
}

/**
 * How much of a child's output is kept. Checks print kilobytes; a runaway one
 * must not grow the test worker's heap, and the byte count is kept in full
 * anyway.
 */
export const OUTPUT_CAP = 512 * 1024;

/**
 * The offset a relaying layer adds to a signal number before exiting with it.
 * POSIX, and the one thing in this reading that is genuinely a convention
 * rather than a measurement — which is why the message it produces says so.
 */
const SIGNAL_EXIT_OFFSET = 128;

/**
 * Signal number back to signal name, from Node's own table rather than from a
 * list written here. Where two names share a number (`SIGABRT`/`SIGIOT`,
 * `SIGIO`/`SIGPOLL` on Linux) the first Node declares wins, so the answer is
 * deterministic and is the canonical spelling in both pairs.
 */
const SIGNAL_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(constants.signals)
    .reverse()
    .map(([name, number]) => [number, name] as const),
);

/**
 * The signal a wrapper is reporting by exiting with this code, or null where the
 * code names no signal Node knows.
 *
 * Deliberately not a test of "is this 137": every layer of the stack relays
 * every signal the same way, and a SIGTERM from a CI timeout is as much not the
 * check's behaviour as a SIGKILL from the OOM killer.
 */
export function relayedSignalOf(code: number): string | null {
  return SIGNAL_NAMES.get(code - SIGNAL_EXIT_OFFSET) ?? null;
}

export interface SpawnCheckOptions {
  readonly cwd: string;
}

/**
 * Runs one check to completion and reports what happened to it.
 *
 * It never rejects: a check that fails, one that is killed and one that cannot
 * be started are three findings, not three exceptions, and the caller asserts
 * over them.
 */
export function spawnCheck(
  command: string,
  argv: readonly string[],
  options: SpawnCheckOptions,
): Promise<SpawnedCheck> {
  const oomBaseline: CgroupMemory | null = readCgroupMemory();

  return new Promise((resolve) => {
    const child = spawn(command, [...argv], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let bytes = 0;
    let unspawned: string | null = null;

    const collect = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (output.length < OUTPUT_CAP) output += chunk.toString('utf8').slice(0, OUTPUT_CAP - output.length);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error: Error) => {
      unspawned = error.message;
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        output,
        bytes,
        oom: oomVerdict(oomBaseline, readCgroupMemory()),
        termination: terminationOf(unspawned, code, signal),
      });
    });
  });
}

/**
 * The `close` event's answers, classified. Order matters: an unspawnable
 * command reports a code too, and a directly signalled child is the one reading
 * the kernel gave us rather than one a convention inferred.
 */
function terminationOf(
  unspawned: string | null,
  code: number | null,
  signal: NodeJS.Signals | null,
): CheckTermination {
  if (unspawned !== null) return { kind: 'unspawned', reason: unspawned };
  if (signal !== null) return { kind: 'signal', signal };
  const exit = code ?? 0;
  const relayed = relayedSignalOf(exit);
  return relayed === null
    ? { kind: 'exit', code: exit }
    : { kind: 'relayed-signal', code: exit, signal: relayed };
}

/** Whether the child got as far as an answer of its own, of any colour. */
export function reachedItsOwnVerdict(seen: SpawnedCheck | undefined): boolean {
  return seen?.termination.kind === 'exit';
}

/**
 * What the container's own counters say about the window this child was alive
 * for, as one sentence.
 *
 * The *verdict* is `test/oom-evidence.ts`' — one derivation of "did an OOM
 * killer take a process of this cgroup, and was it this cgroup's own limit that
 * fired". The *sentence* is not `renderOomVerdict`'s, and deliberately: that one
 * speaks about the whole run and sends its reader to how much of the host the
 * job is sharing, which is the right advice for a dead vitest fork and the wrong
 * advice for one check of a pool. Same answer, two audiences.
 *
 * Exported so all three branches can be proven: only one of them is reachable
 * on any given machine — a developer box has no cgroup v2 view of itself and
 * reads `unreadable` every time — and the branch that matters most is the one
 * that fires on the runner nobody is sitting at.
 */
export function oomSentence(oom: OomVerdict): string {
  const MB = 1024 * 1024;
  switch (oom.kind) {
    case 'unreadable':
      return (
        'There is no cgroup v2 accounting to read here, so nothing is claimed either way about ' +
        'memory — on the CI runner this line names the kernel evidence.'
      );
    case 'none':
      return (
        "The kernel says it was not memory: this container's `memory.events` counted no " +
        '`oom_kill` while this check was running. Look for a signal from outside the ' +
        'container — a job timeout, a supervisor, a `kill` — rather than for a memory limit.'
      );
    case 'killed': {
      const many = oom.kills === 1 ? 'process was' : 'processes were';
      const where =
        oom.by === 'cgroup-limit'
          ? `this container's own${oom.limitBytes === null ? '' : ` ${String(Math.round(oom.limitBytes / MB))} MB`} limit is what fired (\`oom\` moved too)`
          : "this container's own limit did not fire (`oom` did not move), so it came from the host";
      return (
        `The kernel accounts for a kill: in this container's \`memory.events\`, \`oom_kill\` ` +
        `moved by ${String(oom.kills)} while this check was running, so ${String(oom.kills)} ` +
        `${many} killed by an OOM killer, and ${where}. The counter is the container's, not ` +
        'this child\'s, so it says a kill happened in this window and not that this child was ' +
        'the one taken.'
      );
    }
  }
}

/**
 * The sentence that follows a kill, whichever layer took the signal: this is a
 * resource failure of what the run was executed *inside*, and the reader is to
 * go and look at that rather than at the check.
 */
function killedElsewhere(script: string, seen: SpawnedCheck): string {
  return (
    `It reached no verdict of its own, so this says nothing about ${script} and everything ` +
    'about what it was run inside: look at the pool size in check-read-size.test.ts, at ' +
    "PEAK_BYTES_PER_CHECK beside it, and at the container's memory limit. " +
    `${oomSentence(seen.oom)}`
  );
}

/**
 * One sentence per way a spawn can end badly, so the reader is sent to the
 * right place. The four are deliberately not interchangeable: a kill — whether
 * this process witnessed it or a surviving wrapper relayed it — is a resource
 * failure of the *runner*, an unspawnable command is a broken invocation, and a
 * silent exit is the check's own behaviour.
 */
export function terminationReport(script: string, seen: SpawnedCheck | undefined): string {
  if (seen === undefined) return `${script} was never spawned.`;
  const tail = `Its output was:\n${seen.output}`;
  const printed = `having printed ${String(seen.bytes)} byte(s) before it died`;
  switch (seen.termination.kind) {
    case 'signal':
      return (
        `${script} was killed by ${seen.termination.signal}, ${printed}. ` +
        `The process was terminated from outside. ${killedElsewhere(script, seen)} ` +
        tail
      );
    case 'relayed-signal':
      return (
        `${script} exited ${String(seen.termination.code)}, which is how a surviving wrapper ` +
        `reports that its own child was killed by ${seen.termination.signal} ` +
        `(128 + ${String(seen.termination.code - SIGNAL_EXIT_OFFSET)}), ${printed}. It is ` +
        'spawned through `pnpm exec tsx`, so the process holding the TypeScript program is ' +
        'two layers in: that one was killed, its two ancestors survived and relayed the ' +
        'code, and this parent therefore sees an exit code where the kernel would have given ' +
        `it a signal. ${killedElsewhere(script, seen)} ` +
        'If this check genuinely exits with this code as a verdict of its own, then this ' +
        'reading is the wrong one and the discrimination has to grow a way to tell the two ' +
        `apart — no check in this estate does; they exit 0, 1 and 2. ${tail}`
      );
    case 'unspawned':
      return `${script} could not be spawned at all: ${seen.termination.reason}. ${tail}`;
    case 'exit':
      return (
        `${script} exited ${String(seen.termination.code)} and printed no read line — it ran ` +
        `to a verdict of its own, so this is the check's behaviour. ${tail}`
      );
  }
}
