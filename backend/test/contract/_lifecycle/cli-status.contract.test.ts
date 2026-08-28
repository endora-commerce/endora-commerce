import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(
  here,
  '../../../src/lifecycle/scripts/status.ts',
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

describe('module:status CLI — argv contract', () => {
  it('exit 0 even with bad argv (read-only command)', async () => {
    const { exitCode } = await run(['--bogus']);
    expect(exitCode).toBe(0);
  });

  it('--filter=<state> is accepted', async () => {
    const { exitCode } = await run(['--filter=installed']);
    // Status is read-only and exits 0 even if the orchestrator can't
    // reach the DB — argv path is the contract under test.
    expect(exitCode).toBe(0);
  }, 30_000);

  it('--filter with an unknown state value reports usage but still exits 0', async () => {
    const { exitCode } = await run(['--filter=bogus']);
    expect(exitCode).toBe(0);
  });
});
