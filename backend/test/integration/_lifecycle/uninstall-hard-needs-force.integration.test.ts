import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../../src/lifecycle/scripts/uninstall.ts');
/** Runs the same entry point with every interactivity signal reading true. */
const interactively = resolve(here, '../../helpers/interactive-run.ts');

/** The step-6 refusal, as an operator reads it. */
const STEP_SIX = /--hard.*--force/;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await exec('pnpm', ['exec', 'tsx', ...args]);
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

/**
 * `module:uninstall --hard` requires `--force` — **on every run** (owner ruling
 * **D-217**, `specs/080-f4-real-scope/rulings.md`;
 * `specs/018-module-lifecycle/contracts/cli-commands.md` §C-2 step 6).
 *
 * ## Why the second case exists
 *
 * This file held the first case alone, and it cannot tell the ruled behaviour
 * from the one D-217 struck. `execFile` spawns with pipes, so an exit 64 there
 * is equally consistent with *"refuses always"* and with *"refuses because this
 * run is not interactive"* — and the second is what step 6 said from feature 018
 * until 2026-09-07: `--force` **or** a tty prompt confirming `yes` verbatim.
 * That prompt was never built in either tree, so the guard fired only *off* a
 * terminal: `module:uninstall <id> --hard` typed at a prompt reverted the
 * module's migrations and deleted its registry row with no confirmation of any
 * kind. A test that spawns through a pipe is green under that too, which is why
 * the defect survived feature 018, 115 and everything between.
 *
 * **What the second case catches is the fail-open, not today's code.** The
 * predicate is `args.hard && !args.force && !rt.confirm`, and
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` D115-7 records
 * the intent that *"the five entry points supply `confirm` only where the
 * conjunction in R2.7 holds"* — stdin **and** stdout a terminal, and no CI
 * marker. An entry point that does that without also building the prompt hands
 * `--hard` a capability nobody can exercise, and the data loss above is back
 * with every existing test green. This case is what stands in the way, and it
 * is why `test/helpers/interactive-run.ts` forges all four facts rather than
 * only the one an `isTTY` read would have consulted.
 *
 * Cases 1 and 2 reach no database: the refusal answers above
 * `OperatorRuntime.resources`, which is opened on first use (D115-6, R2.6).
 * Case 3 does, and writes nothing — see its own comment.
 */
describe('module:uninstall --hard requires --force', () => {
  it('refuses a run spawned with pipes', async () => {
    const { code, stderr } = await run([script, 'fixture_hard_needs_force', '--hard']);
    expect(code).toBe(64);
    expect(stderr).toMatch(STEP_SIX);
  }, 60_000);

  it('refuses a run that reads as interactive in every way a caller can test', async () => {
    const piped = await run([script, 'fixture_hard_needs_force', '--hard']);
    const interactive = await run([
      interactively,
      script,
      'fixture_hard_needs_force',
      '--hard',
    ]);

    expect(interactive.code).toBe(64);
    expect(interactive.stderr).toMatch(STEP_SIX);
    // Byte-identical to the piped run, so this is the *same* refusal rather
    // than a second exit 64 arrived at some other way — the command has four of
    // them, and "it also exits 64" would be true of a run that never reached
    // step 6 at all.
    expect(interactive.stderr).toBe(piped.stderr);
  }, 120_000);

  it('lets --force carry the same interactive run past step 6', async () => {
    // The discrimination, without which the two cases above assert only that
    // this command exits 64 a great deal.
    //
    // The id is one no manifest declares and no registry row exists for, on
    // purpose: `--hard --force` is a real destructive invocation, and for an
    // unregistered id the orchestrator answers `already-uninstalled` and writes
    // nothing — no hook, no settings sweep, no migration reverted, no row
    // deleted. `cli-uninstall.contract.test.ts` relies on the same property for
    // the legacy `--remove-settings` alias. Naming a real module here would
    // make a passing test the thing that hard-uninstalls it.
    const { code, stderr } = await run([
      interactively,
      script,
      'fixture_hard_needs_force',
      '--hard',
      '--force',
    ]);
    expect(stderr).not.toMatch(STEP_SIX);
    expect(code).not.toBe(64);
  }, 120_000);
});
