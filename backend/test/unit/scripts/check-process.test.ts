import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseReadSize } from '../../../scripts/lib/read-size.js';
import {
  reachedItsOwnVerdict,
  spawnCheck,
  terminationReport,
  type SpawnedCheck,
} from '../../helpers/check-process.js';

/**
 * A check killed by the kernel must not report as a check that printed nothing.
 *
 * `check-read-size.test.ts` spawns twenty-seven processes and tolerates a
 * non-zero exit on purpose. That tolerance made **SIGKILL indistinguishable
 * from silence**: on the 4 GB CI runner the two heaviest checks were OOM-killed
 * before writing a byte and were reported as `printed no read line`, a
 * content-shaped assertion for a resource failure.
 *
 * Every proof below enters over a **real spawned process** — a child that is
 * genuinely killed by a genuine signal, a child that genuinely exits non-zero —
 * because the whole defect lives in what the parent does with a `close` event.
 * A stubbed result would be the shape under test asserted against itself.
 */

const READ_LINE = '[proof] read: files=3 sources=self-reported';

/** A child that prints `text`, then does `then` to itself. */
async function child(script: string): Promise<SpawnedCheck> {
  return spawnCheck(process.execPath, ['-e', script], { cwd: process.cwd() });
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

  it('is not confused with an exit code of the same number', async () => {
    // 137 is what a shell renders a SIGKILL as, and a process may exit 137 of
    // its own accord. The discrimination is the `signal`, never the number.
    const exited = await child('process.exit(137);');

    expect(exited.termination).toEqual({ kind: 'exit', code: 137 });
    expect(reachedItsOwnVerdict(exited)).toBe(true);
    expect(terminationReport('a-check.ts', exited)).not.toContain('killed by');
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
});
