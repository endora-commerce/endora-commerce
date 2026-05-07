import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(
  here,
  '../../../src/modules/_lifecycle/scripts/enable.ts',
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

describe('module:enable CLI — argv contract', () => {
  it('exits 64 with no module id', async () => {
    const { exitCode, stderr } = await run([]);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/missing module id/i);
  });

  it('exits 64 with an unknown flag', async () => {
    const { exitCode, stderr } = await run(['demo', '--bogus']);
    expect(exitCode).toBe(64);
    expect(stderr).toMatch(/unknown flag/);
  });

  it('exits 64 for an id failing the regex', async () => {
    const { exitCode } = await run(['Bad-Id']);
    expect(exitCode).toBe(64);
  });
});
