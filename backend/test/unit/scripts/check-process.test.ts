import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseReadSize } from '../../../scripts/lib/read-size.js';
import {
  oomSentence,
  reachedItsOwnVerdict,
  relayedSignalOf,
  spawnCheck,
  terminationReport,
  type SpawnedCheck,
} from '../../helpers/check-process.js';

/**
 * A check killed by the kernel must not report as a check that printed nothing.
 *
 * `check-read-size.test.ts` spawns one process per check in `CHECKS` and
 * tolerates a non-zero exit on purpose. That tolerance made **SIGKILL indistinguishable
 * from silence**: on the 4 GB CI runner the two heaviest checks were OOM-killed
 * before writing a byte and were reported as `printed no read line`, a
 * content-shaped assertion for a resource failure.
 *
 * Every proof below enters over a **real spawned process** — a child that is
 * genuinely killed by a genuine signal, a child that genuinely exits non-zero —
 * because the whole defect lives in what the parent does with a `close` event.
 * A stubbed result would be the shape under test asserted against itself.
 *
 * ## And over a real *wrapper*, which is the second half
 *
 * The repair above was right one layer in, and the caller spawns one layer out:
 * `pnpm exec tsx <check>` puts two surviving processes between the parent and
 * the program the kernel kills. Each relays its child's death the way POSIX
 * has always relayed one — by exiting `128 + signum` — so the parent sees
 * `{ code: 137, signal: null }`, `signal !== null` never fires, and scheduled
 * pipeline 13573 reported an OOM-killed `check-port-shape` as *"it ran to a
 * verdict of its own, so this is the check's behaviour"*.
 *
 * So {@link wrapped} is a **real forking `sh -c`**, not a stub: the kernel
 * kills a genuine grandchild and a genuine wrapper relays it. The trailing
 * `exit $?` is load-bearing — a single-command `sh -c` `exec`s its argument and
 * there is then no wrapper at all, which is measured: the same fixture without
 * it closes `{ code: null, signal: 'SIGKILL' }` and proves nothing about a
 * relay.
 */

const READ_LINE = '[proof] read: files=3 sources=self-reported';

/** A child that prints `text`, then does `then` to itself. */
async function child(script: string): Promise<SpawnedCheck> {
  return spawnCheck(process.execPath, ['-e', script], { cwd: process.cwd() });
}

/**
 * The same child, behind a surviving wrapper — the shape `pnpm exec tsx`
 * produces, reduced to the one property that matters: a process that outlives
 * the one the kernel took and reports it as an exit code of its own.
 */
async function wrapped(script: string): Promise<SpawnedCheck> {
  return spawnCheck('sh', ['-c', `"$0" -e "$1"; exit $?`, process.execPath, script], {
    cwd: process.cwd(),
  });
}

describe('a child killed by a signal', () => {
  it('is reported as killed, not as silent, when it died before printing', async () => {
    const seen = await child("process.kill(process.pid, 'SIGKILL');");

    expect(seen.termination).toEqual({ kind: 'signal', signal: 'SIGKILL' });
    expect(reachedItsOwnVerdict(seen)).toBe(false);

    const report = terminationReport('backend/scripts/check-port-catches.ts', seen);
    expect(report).toContain('was killed by SIGKILL');
    expect(report).toContain('having printed 0 byte(s)');
    // The sentence the CI log carried instead, which sent its reader into the
    // check's own analysis for a failure that was never the check's.
    expect(report).not.toContain('printed no read line');
  });

  it('says how much it had printed before it died', async () => {
    const seen = await child(
      `process.stdout.write(${JSON.stringify(`${READ_LINE}\n`)});` +
        "setTimeout(() => process.kill(process.pid, 'SIGKILL'), 20);",
    );

    expect(seen.termination).toEqual({ kind: 'signal', signal: 'SIGKILL' });
    expect(seen.bytes).toBe(READ_LINE.length + 1);
    expect(terminationReport('a-check.ts', seen)).toContain(
      `having printed ${READ_LINE.length + 1} byte(s)`,
    );
  });

  it('carries the kernel evidence beside the kill, whatever it says', async () => {
    const seen = await child("process.kill(process.pid, 'SIGKILL');");
    const report = terminationReport('a-check.ts', seen);

    // One of the three, never a silence: `test/oom-evidence.ts` answers
    // "unreadable" off a container rather than downgrading "I could not look"
    // to "nothing happened", and the sentence has to carry that distinction
    // through to the reader.
    expect(['unreadable', 'none', 'killed']).toContain(seen.oom.kind);
    expect(report).toMatch(
      /no cgroup v2 accounting to read|kernel says it was not memory|kernel accounts for a kill/,
    );
  });
});

describe('a child killed behind a surviving wrapper', () => {
  // Pipeline 13573. Every one of these is the relay the tree actually produces,
  // and every one of them used to read as the check's own behaviour.

  it('is reported as killed, not as the check\'s behaviour', async () => {
    const seen = await wrapped('process.kill(process.pid, 9)');

    expect(seen.termination).toEqual({ kind: 'relayed-signal', code: 137, signal: 'SIGKILL' });
    expect(reachedItsOwnVerdict(seen)).toBe(false);

    const report = terminationReport('backend/scripts/check-port-shape.ts', seen);
    expect(report).toContain('killed by SIGKILL');
    expect(report).toContain('(128 + 9)');
    // The two sentences pipeline 13573 printed instead, which sent their reader
    // into an analysis with no bug in it.
    expect(report).not.toContain('printed no read line');
    expect(report).not.toContain("this is the check's behaviour");
  });

  it('sends the reader to the runner, not to the check', async () => {
    const seen = await wrapped('process.kill(process.pid, 9)');
    const report = terminationReport('backend/scripts/check-port-shape.ts', seen);

    expect(report).toContain('says nothing about backend/scripts/check-port-shape.ts');
    expect(report).toContain('PEAK_BYTES_PER_CHECK');
    expect(report).toMatch(
      /no cgroup v2 accounting to read|kernel says it was not memory|kernel accounts for a kill/,
    );
  });

  it('says how much the check had printed before it died', async () => {
    const seen = await wrapped(
      `process.stdout.write('${READ_LINE}'); process.kill(process.pid, 9)`,
    );

    expect(seen.termination.kind).toBe('relayed-signal');
    expect(seen.bytes).toBe(READ_LINE.length);
    expect(terminationReport('a-check.ts', seen)).toContain(
      `having printed ${READ_LINE.length} byte(s)`,
    );
  });

  it('is not a reading about SIGKILL alone', async () => {
    // A CI timeout's SIGTERM is as much not the check's behaviour as the OOM
    // killer's SIGKILL, and every layer of the stack relays both identically.
    // Keying on 137 would have read this one as a verdict.
    const seen = await wrapped('process.kill(process.pid, 15)');

    expect(seen.termination).toEqual({ kind: 'relayed-signal', code: 143, signal: 'SIGTERM' });
    expect(reachedItsOwnVerdict(seen)).toBe(false);
  });

  it('reads the signal out of the platform\'s own table, not a number written here', () => {
    // Nothing in check-process.ts spells 137, 9 or SIGKILL: the mapping is
    // `os.constants.signals`, un-mapped. Where two names share a number the
    // canonical one wins, deterministically.
    expect(relayedSignalOf(128 + constants.signals.SIGKILL)).toBe('SIGKILL');
    expect(relayedSignalOf(128 + constants.signals.SIGSEGV)).toBe('SIGSEGV');
    expect(relayedSignalOf(128 + constants.signals.SIGABRT)).toBe('SIGABRT');

    // A code that names no signal is an ordinary verdict. 2 is the estate's own
    // "nothing was read", and 0 and 1 are the other two a check ever exits.
    for (const code of [0, 1, 2, 127, 128]) expect(relayedSignalOf(code)).toBeNull();
  });

  it('says whether the kernel accounts for the kill, in all three states', () => {
    // The branch that matters is unreachable on the machine anyone writes this
    // on: a developer box has no cgroup v2 view of itself and answers
    // `unreadable` every time, which is what the demonstration of this repair
    // printed. So the sentence is proven over the verdict rather than over the
    // container, and `test/oom-evidence.ts` proves the verdict.
    expect(oomSentence({ kind: 'unreadable' })).toContain('nothing is claimed either way');

    expect(oomSentence({ kind: 'none' })).toContain('kernel says it was not memory');
    expect(oomSentence({ kind: 'none' })).toContain('signal from outside the container');

    const byLimit = oomSentence({
      kind: 'killed',
      kills: 1,
      by: 'cgroup-limit',
      limitBytes: 4 * 1024 * 1024 * 1024,
    });
    expect(byLimit).toContain('kernel accounts for a kill');
    expect(byLimit).toContain('`oom_kill` moved by 1');
    expect(byLimit).toContain("this container's own 4096 MB limit is what fired");
    // Never a claim that this child was the one taken: the counter is the
    // container's, and the caller runs a pool.
    expect(byLimit).toContain('not that this child was the one taken');

    const byHost = oomSentence({ kind: 'killed', kills: 2, by: 'host', limitBytes: null });
    expect(byHost).toContain('it came from the host');
    expect(byHost).toContain('2 processes were');
  });

  it('reports a check that exits 128 + n of its own accord as a relay, and says so', async () => {
    // The one reading this discrimination can get wrong, stated rather than
    // hidden. At the `close` event a wrapper relaying SIGKILL and a process
    // exiting 137 on purpose are the *same two values* — `code: 137,
    // signal: null` — so no analysis here can separate them, and the choice is
    // which way to be wrong. Reporting a killed check as a verdict is the
    // defect this file exists for; reporting a 137-exiting check as a kill
    // costs a sentence the message itself supplies.
    //
    // The rejected alternative was to let the cgroup counters decide — classify
    // as a relay only where `oom_kill` moved. That reads an external SIGTERM as
    // the check's own behaviour, which is the same defect one cause over, and
    // it makes the verdict depend on whether `/sys/fs/cgroup` is readable,
    // which is worse than either answer.
    const seen = await child('process.exit(137);');

    expect(seen.termination).toEqual({ kind: 'relayed-signal', code: 137, signal: 'SIGKILL' });
    // Still red, which is the non-negotiable: a green may not mean "not
    // looking", whichever of the two readings is true.
    expect(reachedItsOwnVerdict(seen)).toBe(false);
    expect(terminationReport('a-check.ts', seen)).toContain(
      'If this check genuinely exits with this code as a verdict of its own',
    );
  });
});

describe('a child that reaches a verdict of its own', () => {
  it('keeps the deliberate tolerance of a non-zero exit that disclosed its read', async () => {
    const seen = await child(
      `process.stdout.write(${JSON.stringify(`${READ_LINE}\nviolations=4\n`)});process.exit(1);`,
    );

    expect(seen.termination).toEqual({ kind: 'exit', code: 1 });
    expect(reachedItsOwnVerdict(seen)).toBe(true);
    // A check may legitimately be red on the working tree; it still disclosed
    // what it read, which is all `check-read-size.test.ts` asks of it.
    expect(parseReadSize(seen.output)).not.toBeNull();
  });

  it('is reported as the check\'s own behaviour when it exits silently', async () => {
    const seen = await child('process.exit(0);');

    expect(seen.termination).toEqual({ kind: 'exit', code: 0 });
    const report = terminationReport('a-check.ts', seen);
    expect(report).toContain('printed no read line');
    expect(report).toContain("the check's behaviour");
    expect(report).not.toContain('killed by');
  });

  it('collects stderr as well as stdout', async () => {
    const seen = await child(
      `process.stderr.write(${JSON.stringify(`${READ_LINE}\n`)});process.exit(2);`,
    );

    expect(seen.termination).toEqual({ kind: 'exit', code: 2 });
    expect(parseReadSize(seen.output)).not.toBeNull();
  });
});

describe('a command that never starts', () => {
  it('is neither killed nor silent', async () => {
    const seen = await spawnCheck('a-command-that-does-not-exist', [], { cwd: process.cwd() });

    expect(seen.termination.kind).toBe('unspawned');
    const report = terminationReport('a-check.ts', seen);
    expect(report).toContain('could not be spawned at all');
    expect(report).not.toContain('killed by');
    expect(report).not.toContain('printed no read line');
  });
});

describe('the spawning test uses this discrimination', () => {
  // The two-way link. The repair is worth nothing if the file that carried the
  // disguise goes back to a caught error, and that regression is one line.
  const source = readFileSync(
    fileURLToPath(new URL('./check-read-size.test.ts', import.meta.url)),
    'utf8',
  );

  it('spawns through the helper', () => {
    expect(source).toContain("from '../../helpers/check-process.js'");
  });

  it('collapses no termination into a caught error', () => {
    expect(source).not.toContain('promisify(execFile)');
    expect(source).not.toMatch(/catch \(error: unknown\)/);
  });

  it('asserts the child reached a verdict of its own', () => {
    expect(source).toContain('reachedItsOwnVerdict');
  });

  it('still spawns through a wrapper, which is what makes a relay the live case', () => {
    // If this ever became a direct `spawn(<the check>)`, the kernel's own
    // `signal` would be authoritative again and every relay proof above would
    // be describing a shape nothing produces. It is not a hypothetical the
    // other direction either: the heaviest process is the innermost one, so
    // even `spawn('tsx', …)` leaves a layer between the kill and the parent.
    expect(source).toContain("kind === 'tsx' ? 'pnpm' : 'bash'");
  });
});
