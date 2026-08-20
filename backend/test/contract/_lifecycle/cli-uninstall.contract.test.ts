import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(
  here,
  '../../../src/modules/_lifecycle/scripts/uninstall.ts',
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

describe('module:uninstall CLI — argv contract', () => {
  it('exits 64 when no module id is supplied', async () => {
    const { exitCode, stderr } = await run([]);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/missing module id/i);
  });

  it('exits 64 with an unknown flag', async () => {
    const { exitCode, stderr } = await run(['demo', '--bogus']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/unknown flag.*--bogus/);
  });

  it('exits 64 for --hard in non-tty without --force', async () => {
    // Subprocess via execFile has no tty by default — exact scenario the
    // safety check protects.
    const { exitCode, stderr } = await run(['settings', '--hard']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/--hard.*--force/);
  }, 30_000);

  it('legacy --remove-settings translates to --hard --force', async () => {
    // Issue #69 — the subject is a module id no manifest declares, for the same
    // reason as in `cli-disable.contract.test.ts`, and with a sharper edge here:
    // `--remove-settings` means `--hard --force`, so on any ordering that had
    // left a `settings` row in `module_registrations` this case would have
    // hard-uninstalled the settings module — reverting its migrations and
    // dropping its tables — for every file that ran afterwards. It survived only
    // because `settings` usually still had registered dependents and the
    // orchestrator refused with `dependents-block`.
    //
    // With an unregistered id the orchestrator finds no registry row, answers
    // `already-uninstalled` and writes nothing, so the exit code is the same on
    // every ordering. The banner check pins what the case is really about: the
    // parser accepted the legacy flag instead of rejecting it as misuse.
    const { exitCode, stderr } = await run(['nonexistent_module', '--remove-settings']);
    expect(stderr).not.toContain('usage: module:uninstall');
    expect(exitCode).not.toBe(64);
  }, 30_000);
});
