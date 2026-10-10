/**
 * The demo sales pipeline while CRM is switched off
 * (`specs/143-crm-sales-opportunities/research.md` N-DD1; Constitution XVII).
 *
 * ## What this file proves, and why `demo-shop.test.ts` could not
 *
 * `demo-shop.test.ts` seeds an instance with every module on, so the guard on
 * the pipeline step and the presence gate on `crm`'s own demo body are never
 * asked a question they answer "no" to. This file asks it, over a real
 * database, by the one thing an operator does: `crm.enabled` set to `false`.
 *
 *  1. **Off at the seed** — the rest of the shop is seeded, `crm` is a reported
 *     skip, the pipeline step is a reported skip naming `crm`, and not one row
 *     reaches a `crm_` table. A module that is off behaves as if it had never
 *     been installed.
 *  2. **Switched on afterwards** — the next seed adds the tags and the
 *     pipeline to the shop that is already there, and nothing else moves.
 *  3. **Off at the reset** — the reset completes. The pipeline *step* is a
 *     reported skip, as a step whose module is absent is in both directions
 *     (contract §5.4), and `crm`'s own demo body does not run, so its three
 *     tags stay. But the Opportunities belong to the demo organisation, and
 *     they are withdrawn with it: operator activation says how a module
 *     behaves, not whether its rows exist, and a row that exists still holds
 *     the foreign key that refuses the organisation's deletion (issue #143).
 *     Until that issue this case asserted the opposite — a reset refused at
 *     `organizations`, by which point the demo payment methods and the buyer
 *     had already been withdrawn and the shop could not be checked out of.
 *  4. **Switched on again** — the next reset withdraws the tags, and no CRM
 *     row is left.
 *
 * The activation value is written straight into `settings.global_value`,
 * between two CLI runs: each `endora demo …` is a process of its own that
 * composes the platform and reads the value at its boot, so there is no cache
 * to refresh and no second CLI entry point to run.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Migrations, then six composed CLI runs. */
const SUITE_TIMEOUT_MS = 900_000;

const RUN = randomBytes(4).toString('hex');
const SHOP_DB = `dpo_${RUN}_shop_test`;
const DEMO_SEED = ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'seed'];
const DEMO_RESET = ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'reset'];

const PIPELINE_STEP = 'sales opportunities for the demo organisation';
const CRM_ACTIVATION_SETTING = 'crm.enabled';

/** Every table of `crm` that holds rows rather than workflow configuration. */
const CRM_ROW_TABLES = [
  'crm_opportunities',
  'crm_opportunity_status_history',
  'crm_opportunity_tags',
  'crm_opportunity_comments',
  'crm_opportunity_references',
  'crm_opportunity_events',
  'crm_opportunity_links',
  'crm_opportunity_message_reads',
  'crm_tags',
] as const;

/** `DATABASE_URL`'s host, port and credentials, with the database replaced. */
function dsnFor(database: string): string {
  const declared = process.env['DATABASE_URL'];
  if (declared === undefined || declared === '') {
    throw new Error(
      'demo pipeline off-state: DATABASE_URL is not set. This test provisions its own ' +
        'throwaway database from the running invocation’s DSN and cannot invent one.',
    );
  }
  const url = new URL(declared);
  url.pathname = `/${database}`;
  return url.toString();
}

interface RunOutcome {
  readonly code: number | null;
  readonly out: string;
  readonly err: string;
}

/** Run a command against the shop and answer with what it did — never throwing on a non-zero exit. */
async function attempt(argv: readonly string[], databaseUrl: string): Promise<RunOutcome> {
  return await new Promise<RunOutcome>((resolveRun, rejectRun) => {
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
    child.on('close', (code) => resolveRun({ code, out, err }));
  });
}

/** Run a command that has to succeed, and fail naming what it printed. */
async function run(label: string, argv: readonly string[], databaseUrl: string): Promise<string> {
  const outcome = await attempt(argv, databaseUrl);
  if (outcome.code !== 0) {
    throw new Error(
      `demo pipeline off-state: ${label} exited with code ${outcome.code}.\n` +
        `--- stdout ---\n${outcome.out}\n--- stderr ---\n${outcome.err}`,
    );
  }
  return outcome.out;
}

async function counts(client: Client, tables: readonly string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from "${table}"`);
    result[table] = Number(rows[0]!.n);
  }
  return result;
}

const NO_CRM_ROWS = Object.fromEntries(CRM_ROW_TABLES.map((table) => [table, 0]));

describe('the demo sales pipeline while CRM is switched off', () => {
  let shop: Client;
  let url: string;

  let seededOff: string;
  let crmAfterOffSeed: Record<string, number>;
  let shopAfterOffSeed: Record<string, number>;
  let seededOn: string;
  let crmAfterOnSeed: Record<string, number>;
  let shopAfterOnSeed: Record<string, number>;
  let resetOff: RunOutcome;
  let crmAfterOffReset: Record<string, number>;
  let organizationsAfterOffReset: number;
  let shopAfterOffReset: Record<string, number>;
  let resetOn: string;
  let crmAfterOnReset: Record<string, number>;
  let workflowAfterOnReset: Record<string, number>;

  /** The shop around the pipeline: what a seed with CRM off must still build. */
  const SHOP_TABLES = ['organizations', 'admin_users', 'products', 'customer_accounts'] as const;

  async function switchCrm(active: boolean): Promise<void> {
    const updated = await shop.query(
      `update settings set global_value = $1 where code = $2`,
      [JSON.stringify(active), CRM_ACTIVATION_SETTING],
    );
    // The row is the platform's, written by the boot that reconciles the
    // manifests. Nothing updated means nothing was switched, and every
    // assertion below would then be about an instance with CRM on.
    expect(updated.rowCount, `no '${CRM_ACTIVATION_SETTING}' setting to switch`).toBe(1);
  }

  beforeAll(async () => {
    const admin = new Client({ connectionString: dsnFor('postgres') });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${SHOP_DB}" with (force)`);
      await admin.query(`create database "${SHOP_DB}"`);
    } finally {
      await admin.end();
    }
    url = dsnFor(SHOP_DB);
    await run('migration:up', ['pnpm', 'exec', 'tsx', 'src/db/migrate.ts', 'up'], url);
    // One boot, so the settings exist to be switched.
    await run('endora demo reset (boot)', DEMO_RESET, url);

    shop = new Client({ connectionString: url });
    await shop.connect();

    await switchCrm(false);
    seededOff = await run('endora demo seed (CRM off)', DEMO_SEED, url);
    crmAfterOffSeed = await counts(shop, CRM_ROW_TABLES);
    shopAfterOffSeed = await counts(shop, SHOP_TABLES);

    await switchCrm(true);
    seededOn = await run('endora demo seed (CRM on)', DEMO_SEED, url);
    crmAfterOnSeed = await counts(shop, CRM_ROW_TABLES);
    shopAfterOnSeed = await counts(shop, SHOP_TABLES);

    await switchCrm(false);
    resetOff = await attempt(DEMO_RESET, url);
    crmAfterOffReset = await counts(shop, CRM_ROW_TABLES);
    organizationsAfterOffReset = (await counts(shop, ['organizations']))['organizations']!;
    shopAfterOffReset = await counts(shop, SHOP_TABLES);

    await switchCrm(true);
    resetOn = await run('endora demo reset (CRM on)', DEMO_RESET, url);
    crmAfterOnReset = await counts(shop, CRM_ROW_TABLES);
    workflowAfterOnReset = await counts(shop, [
      'crm_opportunity_statuses',
      'crm_opportunity_status_transitions',
    ]);
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (shop !== undefined) await shop.end();
    const admin = new Client({ connectionString: dsnFor('postgres') });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${SHOP_DB}" with (force)`);
    } finally {
      await admin.end();
    }
  }, SUITE_TIMEOUT_MS);

  describe('seeding with CRM off', () => {
    it('writes no row into any CRM table', () => {
      expect(crmAfterOffSeed).toEqual(NO_CRM_ROWS);
    });

    it('still seeds the shop around it', () => {
      // The baseline: without it the case above is satisfied by a seed that
      // did nothing at all.
      expect(shopAfterOffSeed).toEqual({
        organizations: 1,
        admin_users: 3,
        products: 203,
        customer_accounts: 1,
      });
    });

    it('reports `crm` and the pipeline step as skipped, each with its reason', () => {
      expect(seededOff).toMatch(/^ {2}crm — not present in this instance/m);
      expect(seededOff).toMatch(new RegExp(`^ {2}${PIPELINE_STEP} — .*'crm' is not present`, 'm'));
      // And not as applied.
      expect(seededOff).not.toMatch(new RegExp(`^ {2}${PIPELINE_STEP}$`, 'm'));
    });
  });

  describe('seeding again once CRM is switched on', () => {
    it('adds the tags and the pipeline to the shop that is already there', () => {
      expect(crmAfterOnSeed).toEqual({
        crm_opportunities: 12,
        crm_opportunity_status_history: 36,
        crm_opportunity_tags: 10,
        crm_opportunity_comments: 6,
        crm_opportunity_references: 3,
        crm_opportunity_events: 8,
        crm_opportunity_links: 0,
        // Nobody has opened a conversation in a shop that was only seeded.
        crm_opportunity_message_reads: 0,
        crm_tags: 3,
      });
      expect(shopAfterOnSeed).toEqual(shopAfterOffSeed);
      expect(seededOn).toMatch(new RegExp(`^ {2}${PIPELINE_STEP}$`, 'm'));
    });
  });

  describe('resetting with CRM off', () => {
    it('completes: a switched-off module does not hold the reset hostage', () => {
      expect(resetOff.code, `${resetOff.out}\n${resetOff.err}`).toBe(0);
      expect(organizationsAfterOffReset).toBe(0);
      // The whole shop, not only the organisation: nothing is left half-way.
      expect(shopAfterOffReset).toEqual({
        organizations: 0,
        admin_users: 0,
        products: 0,
        customer_accounts: 0,
      });
    });

    it('withdraws the Opportunities with the organisation they belong to', () => {
      // `crm_opportunities.organization_id` is `on delete restrict`, and the
      // rows are there whether or not the module is switched on. Their
      // children follow through `crm`'s own cascades.
      expect(crmAfterOffReset).toEqual({ ...NO_CRM_ROWS, crm_tags: 3 });
    });

    it('still reports the pipeline step and `crm` as skipped, and leaves the tags', () => {
      // The step and the module's own body are guarded by presence, and
      // neither ran: the tags are `crm`'s own demo rows, which name nobody.
      expect(resetOff.out).toMatch(new RegExp(`^ {2}${PIPELINE_STEP} — .*'crm' is not present`, 'm'));
      expect(resetOff.out).toMatch(/^ {2}crm — not present in this instance/m);
      expect(crmAfterOffReset['crm_tags']).toBe(3);
    });
  });

  describe('resetting once CRM is switched on again', () => {
    it('completes, and leaves no CRM row behind', () => {
      expect(crmAfterOnReset).toEqual(NO_CRM_ROWS);
      expect(resetOn).toMatch(new RegExp(`^ {2}${PIPELINE_STEP}$`, 'm'));
      expect(resetOn).toMatch(/CrmTag\D+3\b/);
    });

    it('leaves CRM’s workflow as its migration seeded it', () => {
      expect(workflowAfterOnReset).toEqual({
        crm_opportunity_statuses: 6,
        crm_opportunity_status_transitions: 10,
      });
    });
  });
});
