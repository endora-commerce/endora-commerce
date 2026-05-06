import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(
  here,
  '../../../src/modules/_lifecycle/scripts/disable.ts',
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
    // Without a live DB the orchestrator will error out — what we assert
    // here is that the parser accepts --cascade and that the resulting
    // exit code is NOT 64 (the misuse code).
    const { exitCode } = await run(['settings', '--cascade']);
    expect(exitCode).not.toBe(64);
  }, 30_000);

  it('exits 64 with an unknown flag', async () => {
    const { exitCode, stderr } = await run(['demo', '--bogus']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/unknown flag/);
  });
});
