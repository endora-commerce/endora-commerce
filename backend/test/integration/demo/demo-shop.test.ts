/**
 * `endora demo seed` builds this shop, three times over, and gives it back
 * (feature 113, T226 — this file was `demo-parity.test.ts`).
 *
 * ## What it replaced, and why the replacement is a different question
 *
 * Until T226 there were **two** demo seeds — `pnpm --filter backend run
 * seed:dev`, which ran a frozen verbatim copy of every block Phase 2 had moved
 * (`src/seeds/demo-relocated-reference.ts`), and `endora demo seed`, which ran
 * the modules' own — and this file seeded two databases from one migrated
 * template and diffed them. That comparison is what made each batch provably
 * faithful: a batch that lost a column, an adapter name or a whole row was red
 * against the code it had just replaced.
 *
 * **T226 deletes the reference side, so nothing compares two paths any more —
 * because there is only one path.** That is the feature's goal rather than a
 * casualty of it: the frozen copy was a *transitional* oracle, and keeping it
 * would mean every future edit to a module's demo body reds a test whose only
 * repair is to edit the frozen copy, at which point it is not frozen and
 * asserts nothing.
 *
 * The oracle was spent once more on the way out. Measured on 2026-09-09 over
 * two throwaway databases, one seeded by each path through
 * `endora demo reset` → `endora demo seed`: **276 of 279 tables identical**,
 * and each of the three differences is a repair this task makes rather than a
 * regression it hides —
 *
 *  - `audit_log_entries` 10 → 6: the old reset truncated `sales_channels`, so
 *    the next boot's reconciler had to promote a channel again and audited
 *    itself doing it.
 *  - `blog_category_sales_channels` 0 → 1: `blog`'s `Default` category keeps
 *    its channel binding across a demo reset. Forecast in the task list
 *    (§3.2a.10.4) as the thing that *"retires with the sales-channel block"*.
 *  - `warehouse_channel_assignments` 5 → 4: there is **no** foreign key on
 *    that table's `sales_channel_id`, so the truncate left assignment rows
 *    pointing at channels that no longer existed. The filtered withdrawal that
 *    replaces it removes them with the channel.
 *
 * ## So what does this file assert instead
 *
 * Three properties, none of which the parity comparison could see, because two
 * paths agreeing says nothing about whether either is right:
 *
 *  1. **The delta ledger** — every table the seed moves, and by how much,
 *     recorded and reconciled two ways. A table the seed stops writing fails; a
 *     table it starts writing fails; a magnitude that moves fails. It is the
 *     estate's ledger idiom rather than a golden dump: each entry is a
 *     deliberate statement about the shop, grouped by whose rows they are.
 *  2. **The shop hangs together** — relational invariants over natural keys,
 *     which is what catches a faithful count of the wrong rows. Every demo
 *     product bridged exactly once to a category and once to the channel; both
 *     channels carrying the demo warehouse; the 60/40 stock split; every
 *     advertised sign-in resolving to a row that holds the role it claims.
 *  3. **Seed thrice, reset once** — SC-007 at the command level, and the
 *     withdrawal putting every ledgered table back where the baseline left it,
 *     with an empty two-way escape. Neither is a property a single-run
 *     differential comparison could express: parity ran each seed exactly once
 *     and never withdrew.
 *
 * ## Why the baseline is a `demo reset` and not a migrated database
 *
 * `endora demo seed` composes the platform before it seeds, so a boot runs
 * first and its reconcilers write — on a freshly migrated database, one boot
 * inserts the module registrations, the settings, the countries, the
 * currencies, the product-feed taxonomy and a system-default sales channel.
 * Measuring the seed against a migrated database measures the boot. So the
 * database is put through one `endora demo reset` first, which boots and
 * withdraws, and what is ledgered is the **delta** the seed then produces.
 *
 * ## Why an integration test rather than an acceptance script
 *
 * Constitution III defines this tree as the one that exercises the real
 * database, and that is exactly the subject. The alternative shape —
 * `backend/scripts/acceptance/`, as `package-schema` takes — buys a CI job of
 * its own and costs a package script, a `gate-coverage` classification, an
 * entry-scope program and a read-size record, none of which makes the
 * assertions stronger. The cost of this shape is that no merge-request pipeline
 * runs it (D-198); the nightly `master` suite does.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** ~90 s of migrations, one reset, three seeds and a second reset. */
const SUITE_TIMEOUT_MS = 900_000;

/**
 * The DSN this run was given, with its database replaced.
 *
 * `DATABASE_URL` — never `TEST_DATABASE_URL` — is the run's own database since
 * issue #189, and it is read for its **host, port and credentials** only: the
 * databases below are created and dropped by this file and are nobody else's.
 */
function dsnFor(database: string): string {
  const declared = process.env['DATABASE_URL'];
  if (declared === undefined || declared === '') {
    throw new Error(
      'demo shop: DATABASE_URL is not set. This test provisions its own throwaway ' +
        'databases from the running invocation’s DSN and cannot invent one.',
    );
  }
  const url = new URL(declared);
  url.pathname = `/${database}`;
  return url.toString();
}

function maintenanceClient(): Client {
  return new Client({ connectionString: dsnFor('postgres') });
}

/**
 * Run a command with one environment variable overridden, and fail loudly.
 *
 * `stdio` is captured rather than inherited so a failure names what the child
 * printed. A seed that half-ran and exited 0 would be indistinguishable from a
 * complete one, which is the failure `DemoRunFailedError` exists for one layer
 * down; here the exit code is the whole discrimination.
 */
async function run(
  label: string,
  argv: readonly string[],
  databaseUrl: string,
): Promise<string> {
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
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolveRun(out);
        return;
      }
      rejectRun(
        new Error(
          `demo shop: ${label} exited ${signal === null ? `with code ${code}` : `on ${signal}`}.\n` +
            `--- stdout ---\n${out}\n--- stderr ---\n${err}`,
        ),
      );
    });
  });
}

/**
 * Every base table in `public`, with its row count.
 *
 * Derived from `information_schema`, so a table the seed starts writing joins
 * the ledger by existing. `mikro_orm_migrations` is excluded because the
 * database is a clone of a migrated template and its content is the template's.
 */
async function tableCounts(client: Client): Promise<Record<string, number>> {
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name <> 'mikro_orm_migrations'
      order by table_name`,
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const counted = await client.query<{ n: string }>(
      `select count(*)::text as n from "${row.table_name}"`,
    );
    counts[row.table_name] = Number(counted.rows[0]!.n);
  }
  return counts;
}

/**
 * What one `endora demo seed` adds to a shop that has just been reset.
 *
 * **Two-way and recorded, which is the whole point.** A table the seed stops
 * moving fails here, a table it starts moving fails here, and a magnitude that
 * changes fails here — so the demo cannot quietly shrink, grow or lose a step,
 * which is what the frozen reference used to say and what nothing else in the
 * repository can say now. Re-record an entry when the demo legitimately
 * changes; never widen an assertion to make a run pass.
 *
 * Measured on 2026-09-09, over a clone of a migrated template put through one
 * `endora demo reset`. The grouping is by whose rows they are, because that is
 * the fact this whole feature exists to make true.
 */
const SEED_DELTA: Readonly<Record<string, number>> = {
  // ── the composition's foundation (§5.5a) ───────────────────────────────
  // One, not two: the retail channel **adopts** the instance's system-default
  // channel, which the reset's own boot left behind. Only `pl_b2b_vip` is new.
  sales_channels: 1,

  // ── the modules' own rows ──────────────────────────────────────────────
  admin_roles: 2,
  admin_users: 3,
  organizations: 1,
  taxes: 1,
  delivery_methods: 1,
  payment_methods: 2,
  warehouses: 1,
  // Three: the demo warehouse against both channels, plus the system warehouse
  // against the channel this run created. The fourth — the system warehouse
  // against the adopted channel — is the reset's own boot's and is already in
  // the baseline.
  warehouse_channel_assignments: 3,
  categories: 13,
  products: 203,
  grouped_items: 2,
  bundle_slots: 1,
  bundle_slot_options: 2,

  // ── the composition's wiring, step by step ─────────────────────────────
  // 1 — the megamenu over the category tree
  megamenus: 1,
  megamenu_items: 12,
  megamenu_bindings: 4,
  // 2 — the product↔category and channel↔product bridges
  product_categories: 203,
  sales_channel_products: 203,
  // 3 — the price-list backfill
  price_list_products: 203,
  price_list_price_brackets: 406,
  // 4 — the stock spread across the two warehouses
  stock_levels: 406,
  // 5 — the demo buyer joins the demo organisation
  customer_accounts: 1,
  // 6 — the product attributes: a `custom_fields` definition per `catalog` row
  custom_field_definitions: 7,
  custom_field_options: 13,
  product_attributes: 7,
  attribute_set_attributes: 7,
  // 7 — the placeholder images. 500 gallery assets plus 2 attachment assets.
  assets: 502,
  product_assets: 500,
  gallery_items: 500,
  gallery_item_labels: 500,
  // 8 — the sample attachments
  product_attachments: 6,
  // 9 — the demo administrators take their roles. No table of its own: it
  //     assigns `admin_users.admin_role_id`, asserted relationally below.
  // 10 — the credit limit granted to the demo organisation
  credit_limits: 1,
};

/**
 * What a `demo reset` deliberately does **not** put back, and why.
 *
 * **It lands empty, and that is the finding rather than an oversight.** The
 * baseline is itself a reset database, so "the withdrawal restores the
 * baseline" is a total claim over every table the seed moved — including
 * `sales_channels`, where the retail channel *adopts* the instance's own
 * system-default channel rather than creating a second one
 * (`sales_channels_one_system_default` is a real unique index), so the row the
 * reset leaves standing is the row the baseline already had.
 *
 * Two-way like the ledger above: a table kept without an entry fails, and an
 * entry describing rows that are no longer kept fails. An entry is a decision
 * that some demo row is deliberately not withdrawn, which is the one thing this
 * feature spent five batches removing — so adding one needs a sentence saying
 * why the operator should not get that row back.
 */
const KEPT_BY_RESET: Readonly<Record<string, string>> = {};

/**
 * What the **platform's boot** reconciles to a shop the previous run created,
 * so it moves between the first seed and the second and then stops.
 *
 * Not the demo's rows and not an idempotence failure: `endora demo seed`
 * composes the platform before it seeds, so the first run's boot sees the
 * channels the *reset* left and the second run's sees the channel the first run
 * created. The demo writes none of these rows on any run.
 *
 * Two-way and reasoned, in the shape the parity comparison used for the same
 * tables: a table that stops being reconciled fails, and so does one that
 * starts. Magnitudes are deliberately not recorded — `cms_hook_sales_channels`
 * is one row per shipped CMS hook per channel and moves whenever a module adds
 * a hook — which is why the total statement below is `afterThird` against
 * `afterSecond`, where both boots have seen the same channels.
 */
const BOOT_RECONCILED: Readonly<Record<string, string>> = {
  cms_hook_sales_channels:
    'one row per shipped CMS hook per channel — the second run’s boot binds every hook to ' +
    'the channel the first run created, and the third run’s finds nothing left to bind.',
};

/** Names must fit PostgreSQL's 63-byte identifier limit and end in `_test`. */
const RUN = randomBytes(4).toString('hex');
const TEMPLATE_DB = `ds_${RUN}_tpl_test`;
const SHOP_DB = `ds_${RUN}_shop_test`;
const DEMO_SEED = ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'seed'];
const DEMO_RESET = ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'reset'];

/** The slug prefix every demo product carries. */
const DEMO_PRODUCT_SLUG_PREFIX = 'demo-';
/** The sign-ins the demo advertises, and the role each holds. */
const DEMO_ROLE_HOLDERS: Readonly<Record<string, string>> = {
  'admin@demo.local': 'platform_admin',
  'sales-rep@demo.local': 'sales_representative',
  'sales-rep-other@demo.local': 'sales_representative',
};

async function query<T extends object>(client: Client, sql: string): Promise<T[]> {
  return (await client.query<T>(sql)).rows;
}

describe('T226 — `endora demo seed` builds this shop', () => {
  let baseline: Record<string, number>;
  let afterFirst: Record<string, number>;
  let afterSecond: Record<string, number>;
  let afterThird: Record<string, number>;
  let afterReset: Record<string, number>;
  let seedReports: string[];
  let shop: Client;

  beforeAll(async () => {
    const admin = maintenanceClient();
    await admin.connect();
    try {
      for (const database of [TEMPLATE_DB, SHOP_DB]) {
        await admin.query(`drop database if exists "${database}" with (force)`);
      }
      await admin.query(`create database "${TEMPLATE_DB}"`);
    } finally {
      await admin.end();
    }

    // One migration run, one clone. `create database … template` is the same
    // ~1 s trick `test/global-setup.ts` uses per invocation.
    await run(
      'migration:up',
      ['pnpm', 'exec', 'tsx', 'src/db/migrate.ts', 'up'],
      dsnFor(TEMPLATE_DB),
    );
    const cloner = maintenanceClient();
    await cloner.connect();
    try {
      await cloner.query(`create database "${SHOP_DB}" template "${TEMPLATE_DB}"`);
    } finally {
      await cloner.end();
    }

    const url = dsnFor(SHOP_DB);
    const reading = new Client({ connectionString: url });
    await reading.connect();
    try {
      // The baseline is a booted, withdrawn database — see the header.
      await run('endora demo reset (baseline)', DEMO_RESET, url);
      baseline = await tableCounts(reading);

      seedReports = [];
      seedReports.push(await run('endora demo seed (1)', DEMO_SEED, url));
      afterFirst = await tableCounts(reading);
      seedReports.push(await run('endora demo seed (2)', DEMO_SEED, url));
      afterSecond = await tableCounts(reading);
      seedReports.push(await run('endora demo seed (3)', DEMO_SEED, url));
      afterThird = await tableCounts(reading);

      // The withdrawal, measured here rather than in `afterAll` so that a
      // failure inside it fails a case rather than a hook — and after the
      // snapshots above, which is the only order in which both can be read.
      await run('endora demo reset (withdrawal)', DEMO_RESET, url);
      afterReset = await tableCounts(reading);

      // Back to a seeded shop for the relational assertions, which read it.
      await run('endora demo seed (re-seed)', DEMO_SEED, url);
    } finally {
      await reading.end();
    }

    shop = new Client({ connectionString: url });
    await shop.connect();
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (shop !== undefined) await shop.end();
    const admin = maintenanceClient();
    await admin.connect();
    try {
      for (const database of [SHOP_DB, TEMPLATE_DB]) {
        await admin.query(`drop database if exists "${database}" with (force)`);
      }
    } finally {
      await admin.end();
    }
  }, SUITE_TIMEOUT_MS);

  /** What the seed actually moved, over the baseline. */
  function observedDelta(after: Record<string, number>): Record<string, number> {
    const moved: Record<string, number> = {};
    for (const [table, count] of Object.entries(after)) {
      const before = baseline[table] ?? 0;
      if (count !== before) moved[table] = count - before;
    }
    return moved;
  }

  describe('the delta ledger', () => {
    it('moves exactly the tables it is recorded as moving, by the recorded amounts', () => {
      // Two-way in one assertion: a table missing from the observation, a table
      // the ledger does not name, and a magnitude that moved all fail here, and
      // the diff names each of them.
      expect(
        observedDelta(afterFirst),
        'the demo seed no longer builds the shop this file records. Each key is a table ' +
          'and each value the rows one seed adds to a freshly reset database. Re-record an ' +
          'entry when the demo legitimately changes; never widen this to make a run pass.',
      ).toEqual(SEED_DELTA);
    });

    it('wrote a shop at all', () => {
      // The baseline assertion, not the subject: without it the comparison
      // above is satisfied by a ledger somebody emptied.
      expect(Object.keys(SEED_DELTA).length).toBeGreaterThan(20);
      expect(SEED_DELTA['products']).toBe(203);
    });
  });

  describe('the shop hangs together', () => {
    it('bridges every demo product to exactly one category and one channel', async () => {
      const [row] = await query<{ products: string; categories: string; channels: string }>(
        shop,
        `select
           (select count(*) from products
             where slug like '${DEMO_PRODUCT_SLUG_PREFIX}%')::text as products,
           (select count(*) from product_categories pc
              join products p on p.id = pc.product_id
             where p.slug like '${DEMO_PRODUCT_SLUG_PREFIX}%')::text as categories,
           (select count(*) from sales_channel_products scp
              join products p on p.id = scp.product_id
              join sales_channels ch on ch.id = scp.sales_channel_id
             where p.slug like '${DEMO_PRODUCT_SLUG_PREFIX}%'
               and ch.system_default)::text as channels`,
      );
      // A count of the *wrong* rows is what a table-count ledger cannot see:
      // this is the same number reached through the joins rather than the
      // tables, so a bridge pointing at a stale category fails here.
      expect(row).toEqual({ products: '203', categories: '203', channels: '203' });
    });

    it('assigns the demo warehouse to both sales channels', async () => {
      // The ordering property §5.5a exists for, read out of the shop: the
      // channels are the composition's foundation and `inventory`'s body
      // enumerates them, so a foundation that ran late would show up here as a
      // single row and as nothing else anywhere.
      const rows = await query<{ warehouse: string; channel: string }>(
        shop,
        `select w.code as warehouse, ch.code as channel
           from warehouse_channel_assignments a
           join warehouses w on w.id = a.warehouse_id
           join sales_channels ch on ch.id = a.sales_channel_id
          where w.code = 'pl-krk'
          order by ch.code`,
      );
      expect(rows).toEqual([
        { warehouse: 'pl-krk', channel: 'pl_b2b_vip' },
        { warehouse: 'pl-krk', channel: 'pl_retail' },
      ]);
    });

    it('leaves no assignment pointing at a channel that is not there', async () => {
      // There is no foreign key on `warehouse_channel_assignments.
      // sales_channel_id`, which is how the `truncate sales_channels cascade`
      // this task removed left three orphan rows behind without failing.
      const orphans = await query<{ n: string }>(
        shop,
        `select count(*)::text as n from warehouse_channel_assignments a
          where not exists (select 1 from sales_channels ch where ch.id = a.sales_channel_id)`,
      );
      expect(orphans[0]!.n).toBe('0');
    });

    it('spreads stock 60/40 across the two warehouses', async () => {
      // The quantity itself is derived from a random per-row UUID, so it is not
      // a value that can be recorded — the *split* is the rule the step
      // implements and is decidable inside one database.
      const rows = await query<{ sku: string; default_qty: string; krakow_qty: string }>(
        shop,
        `select p.sku,
                max(case when w.code = 'default' then s.on_hand end)::text as default_qty,
                max(case when w.code = 'pl-krk' then s.on_hand end)::text as krakow_qty
           from stock_levels s
           join products p on p.id = s.product_id
           join warehouses w on w.id = s.warehouse_id
          group by p.sku
         having count(*) = 2
          order by p.sku`,
      );
      expect(rows.length, 'no product carries stock in both warehouses').toBeGreaterThan(100);
      const wrong = rows.filter((row) => {
        const total = Number(row.default_qty) + Number(row.krakow_qty);
        return Number(row.default_qty) !== Math.floor(total * 0.6);
      });
      expect(wrong, 'the default warehouse does not hold 60% of the product’s stock').toEqual([]);
    });

    it('gives every administrator it advertises the role it advertises', async () => {
      const rows = await query<{ email: string; role_code: string }>(
        shop,
        `select u.email, r.code as role_code
           from admin_users u join admin_roles r on r.id = u.admin_role_id
          order by u.email`,
      );
      expect(Object.fromEntries(rows.map((row) => [row.email, row.role_code]))).toEqual(
        DEMO_ROLE_HOLDERS,
      );
    });

    it('puts the demo buyer in the demo organisation, with a granted limit', async () => {
      // Principle XI's case: `customer_accounts.organization_id` is `NOT NULL`,
      // so the buyer is created by a composition step and by no module — which
      // is why its credentials reach the report through the composition too.
      const rows = await query<{ email: string; tax_id: string; granted: string }>(
        shop,
        `select a.email, o.tax_id, l.granted_amount as granted
           from customer_accounts a
           join organizations o on o.id = a.organization_id
           join credit_limits l on l.organization_id = o.id`,
      );
      expect(rows).toEqual([
        { email: 'buyer@demo-org.example', tax_id: 'PL5210000099', granted: '50000.00' },
      ]);
    });

    it('mirrors the category tree in the megamenu, at both levels', async () => {
      const rows = await query<{ parent_slug: string | null; target_slug: string | null }>(
        shop,
        `select parent_c.slug as parent_slug, c.slug as target_slug
           from megamenu_items i
           left join categories c on c.id = (i.target->>'categoryId')::uuid
           left join megamenu_items p on p.id = i.parent_id
           left join categories parent_c on parent_c.id = (p.target->>'categoryId')::uuid
          order by parent_c.slug nulls first, i.position, c.slug`,
      );
      // Every item points at a category that exists, and every child's parent
      // is a top-level section — the shape a menu built from stale ids breaks.
      expect(rows.every((row) => row.target_slug !== null)).toBe(true);
      const sections = rows.filter((row) => row.parent_slug === null).map((r) => r.target_slug);
      expect(sections.length).toBeGreaterThan(1);
      for (const row of rows.filter((r) => r.parent_slug !== null)) {
        expect(sections).toContain(row.parent_slug);
      }
    });

    it('reports every sign-in it created, the composition’s included', () => {
      // The composition's credentials reach the report through
      // `DemoCompositionResult.credentials`, which T226 added: before it the
      // composed path printed three of the four pairs and said nothing about
      // the fourth, because the only thing that could print the buyer's was
      // the seed script this task deletes.
      const report = seedReports[0]!;
      for (const email of [...Object.keys(DEMO_ROLE_HOLDERS), 'buyer@demo-org.example']) {
        expect(report, `the seed did not print ${email}`).toContain(email);
      }
    });
  });

  describe('seeding is idempotent, and the withdrawal is complete', () => {
    it('leaves the same shop after three runs as after two (SC-007)', () => {
      // Asserted over the **whole database** with no exception list, which is
      // the strongest form available: a run that doubled a table the delta
      // ledger does not name is exactly the case a narrower comparison misses.
      // Runs two and three are the pair where it is a total claim — by then the
      // platform's boot has seen every channel the demo creates.
      expect(afterThird).toEqual(afterSecond);
    });

    it('adds nothing of its own on a second run either', () => {
      // The first-to-third comparison, which is the one an operator would make,
      // and it needs the one declared exception: the *platform's* boot
      // reconciles itself to the channel the first run created. Two-way, so a
      // table that joins or leaves that population fails here.
      const moved = Object.keys(afterThird).filter(
        (table) => afterThird[table] !== afterFirst[table],
      );
      expect(
        moved.sort(),
        'a second demo seed changed a table BOOT_RECONCILED does not account for, or an ' +
          'entry in it describes a reconciliation that no longer happens.',
      ).toEqual(Object.keys(BOOT_RECONCILED).sort());
    });

    it('reports the same counts on the third run as on the first', () => {
      // The other half of SC-007, and the one a row count cannot give: a module
      // whose body re-created its rows and deleted the previous ones would
      // leave the same counts and report something different.
      const entityLines = (report: string): string[] =>
        report
          .split('\n')
          .filter((line) => /^ {2}\w+ — /.test(line))
          .sort();
      expect(entityLines(seedReports[2]!)).toEqual(entityLines(seedReports[0]!));
    });

    it('gives the shop back, keeping only what it declares it keeps', () => {
      // The reverse of the ledger, and a total claim: every table the seed
      // moved is back where the baseline left it. `KEPT_BY_RESET` is the
      // two-way escape and it is empty — see its header for why the adopted
      // sales channel does not need an entry.
      const outstanding: Record<string, { baseline: number; afterReset: number }> = {};
      for (const table of Object.keys(SEED_DELTA)) {
        const before = baseline[table] ?? 0;
        const now = afterReset[table] ?? 0;
        if (now !== before) outstanding[table] = { baseline: before, afterReset: now };
      }
      expect(
        Object.keys(outstanding).sort(),
        'a demo reset left rows behind that KEPT_BY_RESET does not account for, or an ' +
          'entry in it describes rows that are no longer kept.',
      ).toEqual(Object.keys(KEPT_BY_RESET).sort());
      // The ledger is empty today, so the line above is a total claim. Said
      // twice on purpose: an entry added without a reason would weaken it
      // silently, and this is what would then be visibly false.
      expect(Object.keys(KEPT_BY_RESET)).toEqual([]);
    });

    it('leaves the platform’s own rows alone', () => {
      // The class of defect every batch of this feature repaired one table at a
      // time, asserted rather than described: the `truncate … cascade` this
      // task removes took the platform's `default` price list with it, measured
      // at 1 → 0 on `master`.
      expect(afterReset['price_lists']).toBe(baseline['price_lists']);
      expect(afterReset['price_lists']).toBeGreaterThan(0);
      // Exactly one system-default sales channel always exists (D-47…D-51).
      expect(afterReset['sales_channels']).toBe(1);
    });
  });
});
