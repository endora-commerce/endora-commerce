/**
 * `demo seed` on an instance that the CLI scaffolded — the shape that shipped
 * a demo nobody could use (2026-10-01).
 *
 * ## The defect
 *
 * Observed live on a CLI-scaffolded instance: `demo seed` created
 * `admin@demo.local` and both sales representatives with `admin_role_id`
 * NULL, so `/admin/me` answered `role: null, permissions: []` and the admin
 * sidebar was empty; and it created 203 products that no sales channel sold,
 * so the storefront showed none. Every module's own demo rows were there. What
 * was missing was the **composition** — the wiring between them — because the
 * only composition anywhere was a file in this repository's host, and an
 * instance's `cli.ts` passes the dispatcher no loader.
 *
 * ## What this file proves, and why `demo-shop.test.ts` could not
 *
 * `demo-shop.test.ts` runs `src/cli.ts`, which names this repository's
 * composition outright; it was green the whole time the defect was live. This
 * file runs `test/fixtures/demo/instance-shaped-cli.ts` — an instance's
 * `cli.ts`, which supplies **no** `demoComposition` — so the dispatcher's own
 * default decides, and the default is the subject:
 *
 *  1. **Nothing installed** — the ordinary instance (D-216). Only the modules'
 *     own rows, the notice once, and the notice now says how to ask.
 *  2. **The composition package installed** — the instance that asked. The
 *     dispatcher finds `@endora-commerce/demo-composition` by its
 *     `"endora": { "type": "demo-composition" }` declaration, and the demo
 *     administrators hold their roles and the channel sells the products.
 *  3. **`demo reset`** withdraws exactly the demo accounts and links again.
 *
 * Every run carries `DEFAULT_SALES_CHANNEL_CODE=pl_default`, the paid demo's
 * configuration: the demo shop adopts the instance's default channel, and an
 * operator's chosen code is what its storefront is built against.
 *
 * ## How "installed" is built in a checkout
 *
 * Discovery refuses a workspace link, as module discovery does, so the package
 * is installed the way a registry install lays it out: a real directory under
 * an instance root's `node_modules`, carrying its own `package.json`, with its
 * built `dist/` linked in. `ENDORA_INSTANCE_ROOT` names that root — the
 * variable that exists for exactly this case, a platform executed out of a
 * checkout against an instance laid out elsewhere.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACKAGE_ROOT = resolve(BACKEND_ROOT, '..', 'packages', 'demo-composition');

/** Migrations, then five composed CLI runs. */
const SUITE_TIMEOUT_MS = 900_000;

const RUN = randomBytes(4).toString('hex');
const SHOP_DB = `dis_${RUN}_shop_test`;
const INSTANCE_CLI = ['pnpm', 'exec', 'tsx', 'test/fixtures/demo/instance-shaped-cli.ts'];
/** A default channel code an operator chose, as the paid demo's `pl_default`. */
const CONFIGURED_CHANNEL_CODE = 'pl_default';

/** The sign-ins the demo advertises, and the role each is meant to hold. */
const DEMO_ROLE_HOLDERS: Readonly<Record<string, string>> = {
  'admin@demo.local': 'platform_admin',
  'sales-rep@demo.local': 'sales_representative',
  'sales-rep-other@demo.local': 'sales_representative',
};

/** `DATABASE_URL`'s host, port and credentials, with the database replaced. */
function dsnFor(database: string): string {
  const declared = process.env['DATABASE_URL'];
  if (declared === undefined || declared === '') {
    throw new Error(
      'demo instance shape: DATABASE_URL is not set. This test provisions its own throwaway ' +
        'database from the running invocation’s DSN and cannot invent one.',
    );
  }
  const url = new URL(declared);
  url.pathname = `/${database}`;
  return url.toString();
}

async function run(
  label: string,
  argv: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<string> {
  return await new Promise<string>((resolveRun, rejectRun) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: BACKEND_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', rejectRun);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolveRun(out);
        return;
      }
      rejectRun(
        new Error(
          `demo instance shape: ${label} exited ${signal === null ? `with code ${code}` : `on ${signal}`}.\n` +
            `--- stdout ---\n${out}\n--- stderr ---\n${err}`,
        ),
      );
    });
  });
}

/**
 * An instance root whose `node_modules` holds the composition package as a
 * registry install would: a real directory, its own manifest, its built code.
 */
function instanceRootWithComposition(): string {
  const root = mkdtempSync(join(tmpdir(), 'endora-demo-instance-'));
  const installed = join(root, 'node_modules', '@endora-commerce', 'demo-composition');
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    join(installed, 'package.json'),
    readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  );
  symlinkSync(join(PACKAGE_ROOT, 'dist'), join(installed, 'dist'), 'dir');
  return root;
}

/** An instance root with a `node_modules` and nothing in it that declares a composition. */
function emptyInstanceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'endora-demo-instance-'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  return root;
}

interface ShopState {
  readonly roles: Record<string, string | null>;
  readonly defaultChannelCode: string;
  readonly demoProducts: number;
  readonly soldOnDefaultChannel: number;
  readonly menus: number;
  readonly pricedDemoProducts: number;
}

async function shopState(client: Client): Promise<ShopState> {
  const roles = await client.query<{ email: string; role_code: string | null }>(
    `select u.email, r.code as role_code
       from admin_users u left join admin_roles r on r.id = u.admin_role_id
      where u.email = any($1)
      order by u.email`,
    [Object.keys(DEMO_ROLE_HOLDERS)],
  );
  const [channel] = (
    await client.query<{ code: string }>(`select code from sales_channels where system_default`)
  ).rows;
  const [counts] = (
    await client.query<{
      products: string;
      sold: string;
      menus: string;
      priced: string;
    }>(
      `select
         (select count(*) from products where slug like 'demo-%')::text as products,
         (select count(*) from sales_channel_products scp
            join products p on p.id = scp.product_id
            join sales_channels ch on ch.id = scp.sales_channel_id
           where p.slug like 'demo-%' and ch.system_default)::text as sold,
         (select count(*) from megamenus)::text as menus,
         (select count(distinct plp.product_id) from price_list_products plp
            join products p on p.id = plp.product_id
           where p.slug like 'demo-%')::text as priced`,
    )
  ).rows;
  return {
    roles: Object.fromEntries(roles.rows.map((row) => [row.email, row.role_code])),
    defaultChannelCode: channel!.code,
    demoProducts: Number(counts!.products),
    soldOnDefaultChannel: Number(counts!.sold),
    menus: Number(counts!.menus),
    pricedDemoProducts: Number(counts!.priced),
  };
}

describe('`demo seed` on a CLI-scaffolded instance', () => {
  const roots: string[] = [];
  let shop: Client;
  let withoutReport: string;
  let without: ShopState;
  let withReport: string;
  let withComposition: ShopState;
  let afterReset: ShopState;
  let remainingDemoAdmins: number;

  beforeAll(async () => {
    const admin = new Client({ connectionString: dsnFor('postgres') });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${SHOP_DB}" with (force)`);
      await admin.query(`create database "${SHOP_DB}"`);
    } finally {
      await admin.end();
    }
    const url = dsnFor(SHOP_DB);
    await run('migration:up', ['pnpm', 'exec', 'tsx', 'src/db/migrate.ts', 'up'], {
      DATABASE_URL: url,
    });

    const empty = emptyInstanceRoot();
    const installed = instanceRootWithComposition();
    roots.push(empty, installed);

    shop = new Client({ connectionString: url });
    await shop.connect();

    // The instance's own default channel code, as the paid demo configures
    // it. The platform's first boot creates the system-default channel under
    // `DEFAULT_SALES_CHANNEL_CODE`, and the storefront is built against that
    // same code — so a demo that renamed it would sell its products on a
    // channel the storefront never asks for.
    const channel = { DEFAULT_SALES_CHANNEL_CODE: CONFIGURED_CHANNEL_CODE };

    // 1 — the ordinary instance: nothing declares a composition.
    const bare = { DATABASE_URL: url, ENDORA_INSTANCE_ROOT: empty, ...channel };
    await run('demo reset (baseline)', [...INSTANCE_CLI, 'demo', 'reset'], bare);
    withoutReport = await run('demo seed (no composition)', [...INSTANCE_CLI, 'demo', 'seed'], bare);
    without = await shopState(shop);
    await run('demo reset (no composition)', [...INSTANCE_CLI, 'demo', 'reset'], bare);

    // 2 — the instance that asked: the composition package is installed.
    const asked = { DATABASE_URL: url, ENDORA_INSTANCE_ROOT: installed, ...channel };
    withReport = await run('demo seed (composition installed)', [...INSTANCE_CLI, 'demo', 'seed'], asked);
    withComposition = await shopState(shop);

    // 3 — and given back.
    await run('demo reset (composition installed)', [...INSTANCE_CLI, 'demo', 'reset'], asked);
    afterReset = await shopState(shop);
    remainingDemoAdmins = Number(
      (
        await shop.query<{ n: string }>(
          `select count(*)::text as n from admin_users where email = any($1)`,
          [Object.keys(DEMO_ROLE_HOLDERS)],
        )
      ).rows[0]!.n,
    );
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (shop !== undefined) await shop.end();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    const admin = new Client({ connectionString: dsnFor('postgres') });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${SHOP_DB}" with (force)`);
    } finally {
      await admin.end();
    }
  }, SUITE_TIMEOUT_MS);

  describe('with no composition installed — the ordinary instance (D-216)', () => {
    it('seeds the modules’ own rows and leaves them unwired, as the live instance had them', () => {
      // The defect's exact state, reproduced: this is what every CLI-scaffolded
      // instance got, because none of them had a composition.
      expect(without.demoProducts).toBe(203);
      expect(without.soldOnDefaultChannel).toBe(0);
      expect(without.roles).toEqual({
        'admin@demo.local': null,
        'sales-rep-other@demo.local': null,
        'sales-rep@demo.local': null,
      });
    });

    it('says once that the wiring is missing, and how to get it', () => {
      expect(withoutReport).toContain('No demo composition was found');
      // `-w`: an instance root is a pnpm workspace, and a plain `pnpm add` there
      // refuses with ERR_PNPM_ADDING_TO_ROOT — measured on a scaffolded instance.
      expect(withoutReport).toContain('pnpm add -w @endora-commerce/demo-composition');
    });
  });

  describe('with the composition package installed — the instance that asked', () => {
    it('gives every demo administrator the role the demo advertises', () => {
      expect(withComposition.roles).toEqual(DEMO_ROLE_HOLDERS);
    });

    it('sells every demo product on the system-default channel', () => {
      expect(withComposition.demoProducts).toBe(203);
      expect(withComposition.soldOnDefaultChannel).toBe(203);
    });

    it('keeps the default channel code the operator configured', () => {
      // The demo adopts the system-default channel as its retail one. It
      // renamed it `pl_retail` unconditionally, which was harmless in a tree
      // whose default channel is the platform's fallback `default` and breaks
      // every storefront built against a code the operator chose.
      expect(withComposition.defaultChannelCode).toBe(CONFIGURED_CHANNEL_CODE);
    });

    it('builds the menu and prices the catalogue, as the host’s demo always did', () => {
      expect(withComposition.menus).toBe(1);
      expect(withComposition.pricedDemoProducts).toBe(203);
    });

    it('prints no "no composition" notice, and the buyer the composition creates', () => {
      expect(withReport).not.toContain('No demo composition was found');
      expect(withReport).toContain('buyer@demo-org.example');
    });
  });

  describe('`demo reset` gives it back', () => {
    it('withdraws the demo administrators, and with them every role they held', () => {
      expect(remainingDemoAdmins).toBe(0);
      expect(afterReset.roles).toEqual({});
    });

    it('withdraws the products and the links the composition made', () => {
      expect(afterReset.demoProducts).toBe(0);
      expect(afterReset.soldOnDefaultChannel).toBe(0);
      expect(afterReset.menus).toBe(0);
    });
  });
});
