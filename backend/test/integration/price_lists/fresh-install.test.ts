/**
 * Feature 160 (T116; `contracts/conversion-and-removal.md` §5) — a fresh
 * install on the price-book model: an empty database migrated from nothing
 * (what `db:fresh` leaves) and then `module:install --all`, the second half of
 * `pnpm run setup`, which runs every install hook.
 *
 * It must be green, the platform default currency must have its base book —
 * the system book that keeps the old Default list's id — precedence v1 must be
 * HY, and nothing of the old model may exist: neither its tables nor a list
 * carrying its columns.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratedDatabase, type MigratedDatabase } from '../../helpers/migrated-database.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_BASE_BOOK_ID = '00000000-0000-4000-8000-00000000d51b';

async function run(argv: readonly string[], databaseUrl: string): Promise<string> {
  return await new Promise<string>((resolveRun, rejectRun) => {
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
    child.on('close', (code) => {
      if (code === 0) resolveRun(out);
      else rejectRun(new Error(`${argv.join(' ')} exited ${code}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
    });
  });
}

describe('price_lists — a fresh install is on price books (T116)', () => {
  let database: MigratedDatabase;
  let db: Client;

  beforeAll(async () => {
    database = await migratedDatabase('price_lists_fresh', (url) =>
      run(['pnpm', 'exec', 'tsx', 'src/db/migrate.ts', 'up'], url).then(() => undefined),
    );
    await run(['pnpm', 'exec', 'tsx', 'src/lifecycle/scripts/install.ts', '--all'], database.url);
    db = new Client({ connectionString: database.url });
    await db.connect();
  }, 900_000);

  afterAll(async () => {
    await db?.end();
    await database?.drop();
  });

  it('the platform default currency has its base book', async () => {
    const { rows: channel } = await db.query<{ default_currency: string }>(
      `select "default_currency" from "sales_channels" where "system_default"`,
    );
    const currency = channel[0]?.default_currency.trim() ?? 'PLN';
    const { rows } = await db.query<{ id: string; type: string; status: string; audience_kind: string }>(
      `select "id", "type", "status", "audience_kind" from "price_lists" where "is_system" and "currency_code" = $1`,
      [currency],
    );
    expect(rows).toEqual([{ id: DEFAULT_BASE_BOOK_ID, type: 'regular', status: 'active', audience_kind: 'everyone' }]);
  });

  it('precedence version 1 is HY, active', async () => {
    const { rows } = await db.query<{ version: number; state: string; cells: string[]; depth_mode: string }>(
      `select "version", "state", "cells", "depth_mode" from "price_list_precedence"`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, state: 'active', depth_mode: 'within_cell' });
    expect(rows[0]!.cells.slice(0, 2)).toEqual(['org.variant', 'org.product']);
  });

  it('holds nothing of the old model', async () => {
    const { rows: tables } = await db.query<{ table_name: string }>(
      `select "table_name" from information_schema.tables where "table_schema" = 'public'
          and "table_name" in ('price_list_products', 'price_list_price_brackets', 'price_list_items', 'price_list_assignments')`,
    );
    expect(tables).toEqual([]);
    const { rows: columns } = await db.query<{ column_name: string }>(
      `select "column_name" from information_schema.columns where "table_name" = 'price_lists'
          and "column_name" in ('application_rule', 'code', 'is_default', 'modified_at')`,
    );
    expect(columns).toEqual([]);
    const { rows: lists } = await db.query(`select 1 from "price_lists" where not "is_system"`);
    expect(lists).toEqual([]);
  });
});
