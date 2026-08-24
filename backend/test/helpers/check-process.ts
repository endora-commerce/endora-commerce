/**
 * Spawning a check, keeping the one distinction the caught error threw away.
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

/** How the child stopped. Exactly one of the three, never inferred. */
export type CheckTermination =
  /** It reached a verdict of its own and exited with this code. */
  | { readonly kind: 'exit'; readonly code: number }
  /** It was terminated from outside, before any verdict of its own. */
  | { readonly kind: 'signal'; readonly signal: string }
  /** It never started: the command could not be spawned at all. */
  | { readonly kind: 'unspawned'; readonly reason: string };

export interface SpawnedCheck {
  /** stdout and stderr interleaved, truncated at {@link OUTPUT_CAP}. */
  readonly output: string;
  /** Everything the child wrote, whether or not it survived the cap. */
  readonly bytes: number;
  readonly termination: CheckTermination;
}

/**
 * How much of a child's output is kept. Checks print kilobytes; a runaway one
 * must not grow the test worker's heap, and the byte count is kept in full
 * anyway.
 */
export const OUTPUT_CAP = 512 * 1024;

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
        termination:
          unspawned !== null
            ? { kind: 'unspawned', reason: unspawned }
            : signal !== null
              ? { kind: 'signal', signal }
              : { kind: 'exit', code: code ?? 0 },
      });
    });
  });
}

/** Whether the child got as far as an answer of its own, of any colour. */
export function reachedItsOwnVerdict(seen: SpawnedCheck | undefined): boolean {
  return seen?.termination.kind === 'exit';
}

/**
 * One sentence per way a spawn can end badly, so the reader is sent to the
 * right place. The three are deliberately not interchangeable: a kill is a
 * resource failure of the *runner*, an unspawnable command is a broken
 * invocation, and a silent exit is the check's own behaviour.
 */
export function terminationReport(script: string, seen: SpawnedCheck | undefined): string {
  if (seen === undefined) return `${script} was never spawned.`;
  const tail = `Its output was:\n${seen.output}`;
  switch (seen.termination.kind) {
    case 'signal':
      return (
        `${script} was killed by ${seen.termination.signal}, having printed ${seen.bytes} byte(s) ` +
        'before it died. It reached no verdict of its own — the process was terminated from ' +
        'outside, which on a memory-limited runner means the OOM killer — so this says nothing ' +
        'about the check and everything about what it was run inside: look at the pool size in ' +
        `check-read-size.test.ts and at the container's memory limit, not at ${script}. ` +
        tail
      );
    case 'unspawned':
      return `${script} could not be spawned at all: ${seen.termination.reason}. ${tail}`;
    case 'exit':
      return (
        `${script} exited ${seen.termination.code} and printed no read line — it ran to a verdict ` +
        `of its own, so this is the check's behaviour. ${tail}`
      );
  }
}
