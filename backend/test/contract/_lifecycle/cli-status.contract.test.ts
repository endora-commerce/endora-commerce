import { afterAll, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

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

/**
 * Cross-organisation access is audited in the database (owner decision of
 * 2026-10-03). The `module:*` commands never compose, so `composeApp`'s writer
 * is not theirs: each entry point attaches its own before its system scope is
 * entered, and writes through the database `resources()` opens.
 */
describe('module:status CLI — its system scope is audited', () => {
  let db: TestDb | undefined;
  afterAll(async () => {
    await db?.close();
  });

  async function statusRows(): Promise<Array<Record<string, unknown>>> {
    db ??= await setupTestDb();
    return db.orm.em
      .fork()
      .getConnection()
      .execute(
        `select request_id, state_after from audit_log_entries
          where action = 'tenant.escape_hatch' and state_after->>'reason' = 'cli: module status'`,
      );
  }

  it('writes one audit_log_entries row and leaves stdout alone', async () => {
    const before = (await statusRows()).length;

    const { exitCode, stdout, stderr } = await run(['--json']);

    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/tenant\.escape_hatch\.(unpersisted|persist_failed|not_persisted)/);
    // `--json` is a machine-readable channel; the audit plumbing is not on it.
    expect(() => JSON.parse(stdout)).not.toThrow();
    const rows = await statusRows();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)?.['state_after']).toMatchObject({
      scope: 'system',
      entryPoint: 'cli',
      module: 'host',
      occurrences: 1,
    });
  }, 60_000);
});
