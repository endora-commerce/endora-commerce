import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migratedDatabase, type MigratedDatabase } from '../../helpers/migrated-database.js';

/**
 * Issue #120 — a composing CLI command records its process start as **one**
 * `tenant.escape_hatch` row, and its own entry beside it.
 *
 * Every process that composes the application enters a system scope once per
 * boot step and once per module boot hook. Each reason used to be its own row
 * — 26 rows from 55 entries before the command did any work — so five commands
 * in a row left 135 escape-hatch rows beside 6 of any other kind. The
 * architect's ruling of 2026-11-07 keeps every count and drops the noise:
 * `composeApp` brackets its boot, every `boot: …` record inside the bracket
 * folds into one row (reason `boot: process start`, entry point `boot`) whose
 * payload carries the per-(module, reason) breakdown, and the operator's own
 * `cli: …` entry is written exactly as before.
 *
 * Spawned rather than dispatched in-process because the subject is a whole
 * process: the writer `composeApp` attaches, the boot it brackets, the command's
 * scope and the final flush on `dispose()`. `demo-shop.test.ts` spawns the CLI
 * the same way; this file picks the cheapest command that composes, a cart
 * abandonment sweep over a database with no carts.
 */

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SWEEP = ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'carts', 'abandonment-sweep'];
const SUITE_TIMEOUT_MS = 300_000;
/** The boot steps `composeApp` enters a system scope for itself; module hooks come on top. */
const OWN_BOOT_STEPS = 4;

async function run(argv: readonly string[], databaseUrl: string): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', rejectRun);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `${argv.join(' ')} exited ${signal === null ? `with code ${code}` : `on ${signal}`}.\n` +
            `--- stdout ---\n${out}\n--- stderr ---\n${err}`,
        ),
      );
    });
  });
}

interface EscapeHatchRow {
  readonly reason: string;
  readonly entry_point: string | null;
  readonly state_after: {
    readonly scope: string;
    readonly module: string;
    readonly occurrences: number;
    readonly breakdown?: ReadonlyArray<{ module: string; reason: string; occurrences: number }>;
  };
}

describe('a composing CLI command records its process start as one row (issue #120)', () => {
  let database: MigratedDatabase | undefined;
  let rows: EscapeHatchRow[];

  beforeAll(async () => {
    database = await migratedDatabase('psa', async (migrateUrl) => {
      await run(['pnpm', 'exec', 'tsx', 'src/db/migrate.ts', 'up'], migrateUrl);
    });

    const client = new Client({ connectionString: database.url });
    await client.connect();
    try {
      // The clone may already hold escape-hatch rows — whatever built the
      // template composed too — so only the rows the command adds are read.
      const before = (
        await client.query<{ id: string }>(
          `select id::text as id from audit_log_entries where action = 'tenant.escape_hatch'`,
        )
      ).rows.map((row) => row.id);

      await run(SWEEP, database.url);

      rows = (
        await client.query<EscapeHatchRow>(
          `select state_after->>'reason' as reason,
                  state_after->>'entryPoint' as entry_point,
                  state_after
             from audit_log_entries
            where action = 'tenant.escape_hatch'
              and not (id::text = any($1::text[]))
            order by acted_at`,
          [before],
        )
      ).rows;
    } finally {
      await client.end();
    }
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await database?.drop();
  }, SUITE_TIMEOUT_MS);

  const bootRows = (): EscapeHatchRow[] =>
    rows.filter((row) => row.entry_point === 'boot' || row.reason.startsWith('boot: '));

  it('writes exactly one boot row, and its breakdown sums to the entries it folds', () => {
    const boot = bootRows();

    expect(boot.map((row) => row.reason)).toEqual(['boot: process start']);
    const [row] = boot;
    expect(row!.entry_point).toBe('boot');
    expect(row!.state_after).toMatchObject({ scope: 'system', module: 'platform' });

    const breakdown = row!.state_after.breakdown ?? [];
    // The boot steps `composeApp` performs itself, and the module boot hooks
    // beside them (`boot: <module id>`), which outnumber them.
    expect(breakdown).toEqual(
      expect.arrayContaining([
        { module: 'platform', reason: 'boot: load module presence', occurrences: 1 },
        { module: 'platform', reason: 'boot: reconcile the default sales channel', occurrences: 1 },
      ]),
    );
    expect(breakdown.length).toBeGreaterThan(OWN_BOOT_STEPS);
    expect(breakdown.every((entry) => entry.reason.startsWith('boot: '))).toBe(true);
    expect(breakdown.reduce((sum, entry) => sum + entry.occurrences, 0)).toBe(
      row!.state_after.occurrences,
    );
  });

  it('writes the command`s own entry beside it, as before', () => {
    // The operator's entry, opened by the dispatcher over the command line.
    const cli = rows.filter((row) => row.reason.startsWith('cli: '));
    expect(cli.map((row) => row.reason)).toEqual(['cli: carts abandonment-sweep']);
    expect(cli[0]!.entry_point).toBe('cli');
    expect(cli[0]!.state_after).toMatchObject({ scope: 'system', occurrences: 1 });
    expect(cli[0]!.state_after.breakdown).toBeUndefined();

    // Everything that is not the boot is the command's: the dispatcher's entry
    // and the sweep's own scope inside it, written one row per reason as before.
    const rest = rows.filter((row) => !bootRows().includes(row));
    expect(rest.every((row) => row.entry_point === 'cli')).toBe(true);
    expect(rest.every((row) => row.state_after.breakdown === undefined)).toBe(true);
  });
});
