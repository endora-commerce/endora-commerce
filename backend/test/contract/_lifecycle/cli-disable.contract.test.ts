import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(
  here,
  '../../../src/lifecycle/scripts/disable.ts',
);

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec('pnpm', ['exec', 'tsx', script, ...args]);
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('module:disable CLI — argv contract', () => {
  it('exits 64 with no module id', async () => {
    const { exitCode, stderr } = await run([]);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/missing module id/i);
  });

  it('accepts --cascade as a valid flag', async () => {
    // Issue #69 — the subject is a module id no manifest declares, and the
    // assertion is the usage banner rather than the exit code. Both changes
    // are load-bearing.
    //
    // This used to run `disable settings --cascade` against the shared test
    // database and assert `exitCode !== 64`. `mapError` maps `wrong-state` and
    // `unknown-module` onto 64 as well as argv misuse, so the case only passed
    // once some *other* file had written a `settings` row into
    // `module_registrations` — a table nothing truncates and this file does not
    // own. In a `test/contract`-only invocation nothing had, and it failed. Worse,
    // when it did pass it really disabled `settings` and cascaded to every
    // dependent, leaving the registry mutated for every later file in the run.
    //
    // An unregistered id makes the orchestrator refuse before it writes
    // anything, so the CLI reaches it in exactly one state on every ordering.
    // Reaching it at all is the contract: had `--cascade` been rejected as
    // misuse, the parser would have printed the usage banner and the
    // orchestrator would never have been called.
    const { stderr } = await run(['nonexistent_module', '--cascade']);
    expect(stderr).not.toContain('usage: module:disable');
    expect(stderr).toMatch(/unknown module/);
  }, 30_000);

  it('exits 64 with an unknown flag', async () => {
    const { exitCode, stderr } = await run(['demo', '--bogus']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/unknown flag/);
  });
});
