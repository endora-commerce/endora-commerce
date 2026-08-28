import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const installScript = resolve(
  here,
  '../../../src/lifecycle/scripts/install.ts',
);

/**
 * Contract test for `module:install` CLI surface (per
 * `contracts/cli-commands.md` §C-1). Runs the script as a subprocess
 * via tsx so argv parsing, exit codes, and stderr/stdout shape are
 * exercised end-to-end without booting the ORM.
 *
 * Test cases that need the DB / Redis live in
 * `test/integration/_lifecycle/install-*.integration.test.ts`. Here we
 * cover argv-only paths: missing id, unknown flag, unknown module id,
 * bad id format, dry-run JSON shape.
 */

async function runInstall(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec('pnpm', [
      'exec',
      'tsx',
      installScript,
      ...args,
    ]);
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

describe('module:install CLI — argv contract', () => {
  it('exits 64 when no module id is supplied', async () => {
    const { exitCode, stderr } = await runInstall([]);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/missing module id/i);
  });

  it('exits 64 with an unknown flag', async () => {
    const { exitCode, stderr } = await runInstall(['demo', '--bogus']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/unknown flag.*--bogus/);
  });

  it('exits 64 for an id that fails the regex', async () => {
    const { exitCode, stderr } = await runInstall(['Bad-Id']);
    expect(exitCode).toBe(64);
    expect(stderr.toLowerCase()).toMatch(/invalid argument|missing module id|bad-id/);
  });

  it('exits 64 for an unknown but well-formed module id', async () => {
    const { exitCode, stderr } = await runInstall(['nonexistent_module']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/unknown module/);
  });

  it('--dry-run --json emits one machine-readable JSON line and exit 0', async () => {
    const { exitCode, stdout } = await runInstall([
      'settings',
      '--dry-run',
      '--json',
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.id).toBe('settings');
    expect(parsed.dryRun).toBe(true);
    expect(Array.isArray(parsed.dependencies)).toBe(true);
  }, 30_000);

  it('--dry-run prints a human-readable plan and exit 0', async () => {
    const { exitCode, stdout } = await runInstall(['settings', '--dry-run']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\[install\] settings/);
    expect(stdout).toMatch(/DRY RUN/);
  }, 30_000);
});
