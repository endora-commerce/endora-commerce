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
    // Without a real DB the orchestrator path won't get far, but the argv
    // parser MUST accept this without exit 64.
    const { exitCode } = await run(['settings', '--remove-settings']);
    // Either succeeds against a live DB (exit 0/66/70) or fails internal
    // (exit 70). Critically NOT exit 64 — the legacy flag was accepted.
    expect(exitCode).not.toBe(64);
  }, 30_000);
});
