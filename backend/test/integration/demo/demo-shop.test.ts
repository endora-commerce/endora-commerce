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
 * Four properties, none of which the parity comparison could see, because two
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
 *  4. **The access ledger** — the seed crosses every organisation, and the
 *     platform audits each widening of tenant scope as a `tenant.escape_hatch`
 *     row. Those rows are an append-only record of *access*, not shop state, so
 *     they are kept out of the table counts and asserted as what a run owes:
 *     one entry into the system scope of its own, the rest the boot's, and the
 *     same on every re-run. Measured on 2026-10-04: 27 rows per run, 26 of them
 *     the boot's (55 entries across 26 reasons) and one the command's.
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
 * assertions stronger. The cost of this shape is that no pipeline runs it: the
 * integration tree needs live services and no workflow provisions them, so this
 * file is run by hand — which is how its ledger sat stale for a day after the
 * escape-hatch audit landed.
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
 * The `audit_log_entries.action` of a tenant escape-hatch record — one row per
 * distinct widening of tenant scope per flush window, written by the platform's
 * persistent audit writer in every process that composes. The literal, as the
 * two other spawning tests of that writer carry it: this file imports nothing
 * from the platform on purpose, because its subject is a child process.
 */
const ESCAPE_HATCH_ACTION = 'tenant.escape_hatch';

/**
 * Every base table in `public`, with its row count.
 *
 * Derived from `information_schema`, so a table the seed starts writing joins
 * the ledger by existing. `mikro_orm_migrations` is excluded because the
 * database is a clone of a migrated template and its content is the template's.
 *
 * **`audit_log_entries` is counted without its escape-hatch rows**, and that is
 * the one place this function is not a plain `count(*)`. Those rows are an
 * access log, not shop state: every process that composes the platform appends
 * its own, so they grow on each run by construction and no run can be
 * idempotent over them. Counting them here would also make the number depend
 * on the clock — the writer aggregates per flush window, so a boot that
 * straddles a flush writes the same access as two rows. They are not dropped
 * from the file's claims: {@link scopeEntries} reads them, and the access
 * ledger below says what each run owes. Every *other* audit row — a command's,
 * a reconciler's — is still counted here, so a seed that starts auditing a
 * write of its own still fails the delta ledger.
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
      row.table_name === 'audit_log_entries'
        ? `select count(*)::text as n from audit_log_entries where action <> '${ESCAPE_HATCH_ACTION}'`
        : `select count(*)::text as n from "${row.table_name}"`,
    );
    counts[row.table_name] = Number(counted.rows[0]!.n);
  }
  return counts;
}

/** One kind of scope widening, and how many times it has happened so far. */
interface ScopeEntry {
  readonly scope: string;
  readonly entryPoint: string;
  readonly reason: string;
  readonly occurrences: number;
}

/**
 * Every tenant-scope widening recorded so far, summed per kind.
 *
 * **Summed over `occurrences`, never counted as rows.** The writer flushes on a
 * timer, so how many rows one access becomes depends on how long the process
 * ran; how many times the scope was entered does not.
 */
async function scopeEntries(client: Client): Promise<ScopeEntry[]> {
  const { rows } = await client.query<{
    scope: string;
    entry_point: string;
    reason: string;
    occurrences: string;
  }>(
    `select state_after->>'scope' as scope,
            coalesce(state_after->>'entryPoint', '(none)') as entry_point,
            state_after->>'reason' as reason,
            sum((state_after->>'occurrences')::int)::text as occurrences
       from audit_log_entries
      where action = '${ESCAPE_HATCH_ACTION}'
      group by 1, 2, 3
      order by 2, 3, 1`,
  );
  return rows.map((row) => ({
    scope: row.scope,
    entryPoint: row.entry_point,
    reason: row.reason,
    occurrences: Number(row.occurrences),
  }));
}

/** What was recorded between two readings of {@link scopeEntries}. */
function scopeEntriesBetween(
  before: readonly ScopeEntry[],
  after: readonly ScopeEntry[],
): ScopeEntry[] {
  const key = (entry: ScopeEntry): string =>
    JSON.stringify([entry.scope, entry.entryPoint, entry.reason]);
  const earlier = new Map(before.map((entry) => [key(entry), entry.occurrences]));
  return after
    .map((entry) => ({ ...entry, occurrences: entry.occurrences - (earlier.get(key(entry)) ?? 0) }))
    .filter((entry) => entry.occurrences !== 0);
}

/**
 * The one widening `endora demo seed` owes, in the sentence an operator reads.
 *
 * The command enters the system scope once, at its entry point, and everything
 * it writes happens inside that one entry. Kept as the opening words rather
 * than the whole sentence so that rewording the tail does not red this file.
 */
const DEMO_SEED_SCOPE_REASON_PREFIX = 'cli: demo seed';

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
  // One, not two: `platform_admin` is the role every instance has — the
  // reset's own boot ensures it — so the demo finds it there and adds only the
  // sales representative's.
  admin_roles: 1,
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
  // `crm`'s own demo data: the tags the pipeline below is labelled with — the
  // one row of that module that names nobody else's.
  crm_tags: 3,

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
  // 11 — the sales pipeline on CRM's board: twelve Opportunities for the demo
  //      organisation, one status-history row per status each has been in, the
  //      tags they carry, their notes and messages, the index of what those
  //      texts mention, and the Events planned on the open ones. No link: the
  //      demo has no Order and no Quote Request.
  crm_opportunities: 12,
  crm_opportunity_status_history: 36,
  crm_opportunity_tags: 10,
  crm_opportunity_comments: 6,
  crm_opportunity_references: 3,
  crm_opportunity_events: 8,
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
  /** What each of the three seed runs recorded in the escape-hatch audit. */
  let seedScopeEntries: ScopeEntry[][];
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
      seedScopeEntries = [];
      let recorded = await scopeEntries(reading);
      const seedOnce = async (label: string): Promise<Record<string, number>> => {
        seedReports.push(await run(label, DEMO_SEED, url));
        const now = await scopeEntries(reading);
        seedScopeEntries.push(scopeEntriesBetween(recorded, now));
        recorded = now;
        return await tableCounts(reading);
      };
      afterFirst = await seedOnce('endora demo seed (1)');
      afterSecond = await seedOnce('endora demo seed (2)');
      afterThird = await seedOnce('endora demo seed (3)');

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

  describe('the access ledger', () => {
    // The seed crosses every organisation, so the platform audits it: each
    // widening of tenant scope becomes a `tenant.escape_hatch` row. Those rows
    // are kept out of the table counts (see `tableCounts`) and held here
    // instead, as a statement of what a run owes rather than a number of rows —
    // a count would have to be re-recorded for every module that gains a boot
    // hook, and would move with the flush timer besides.

    const ownEntries = (run: number): ScopeEntry[] =>
      seedScopeEntries[run]!.filter((entry) => entry.entryPoint !== 'boot');
    const bootEntries = (run: number): ScopeEntry[] =>
      seedScopeEntries[run]!.filter((entry) => entry.entryPoint === 'boot');

    it('enters the system scope exactly once per run, under the reason an operator reads', () => {
      // Everything that is not the platform's boot is the command's own. One
      // entry, once: a module body or a composition step that opened a scope of
      // its own would appear here as a second line, and so would a seed that
      // re-entered per module.
      for (const run of [0, 1, 2]) {
        const own = ownEntries(run);
        expect(own, `run ${run + 1} widened tenant scope other than through its one entry`).toEqual(
          [
            {
              scope: 'system',
              entryPoint: 'cli',
              reason: expect.stringMatching(new RegExp(`^${DEMO_SEED_SCOPE_REASON_PREFIX}\\b`)),
              occurrences: 1,
            },
          ],
        );
      }
    });

    it('owes the rest to the boot that composed the platform, and to nothing else', () => {
      // `endora demo seed` composes before it seeds, so the boot's own entries
      // are recorded by the same process. Their magnitude is the platform's —
      // one reason per boot step and per module with a boot hook — and is
      // deliberately not recorded, for the reason `BOOT_RECONCILED` gives.
      for (const run of [0, 1, 2]) {
        const boot = bootEntries(run);
        expect(boot.length, `run ${run + 1} recorded no boot entry at all`).toBeGreaterThan(0);
        expect(boot.filter((entry) => !entry.reason.startsWith('boot: '))).toEqual([]);
        expect(boot.filter((entry) => entry.scope !== 'system')).toEqual([]);
      }
    });

    it('widens no further on a re-run than on the run before it', () => {
      // The idempotence claim for the one table that cannot stand still: a
      // re-run appends an access record, and it appends the same one. A body
      // that took a wider path once its rows existed would differ here.
      expect(seedScopeEntries[2]).toEqual(seedScopeEntries[1]);
      expect(seedScopeEntries[1]).toEqual(seedScopeEntries[0]);
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

    it('gives the whole sales pipeline to the demo organisation, two to a status', async () => {
      // Tenant ownership read through the join rather than off the column: an
      // Opportunity is `@OrgScoped`, so one written against any other
      // organisation would be somebody else's pipeline (Principle XI).
      const owners = await query<{ tax_id: string; n: string }>(
        shop,
        `select o.tax_id, count(*)::text as n
           from crm_opportunities c join organizations o on o.id = c.organization_id
          group by o.tax_id`,
      );
      expect(owners).toEqual([{ tax_id: 'PL5210000099', n: '12' }]);

      const statuses = await query<{ status_code: string; n: string }>(
        shop,
        `select status_code, count(*)::text as n from crm_opportunities
          group by status_code order by status_code`,
      );
      expect(Object.fromEntries(statuses.map((row) => [row.status_code, row.n]))).toEqual({
        new: '2',
        qualified: '2',
        proposal: '2',
        negotiation: '2',
        won: '2',
        lost: '2',
      });
    });

    it('assigns the pipeline across the two demo Sales Reps and leaves one with nobody', async () => {
      const rows = await query<{ email: string | null; n: string }>(
        shop,
        `select u.email, count(*)::text as n
           from crm_opportunities c left join admin_users u on u.id = c.assigned_admin_user_id
          group by u.email order by u.email nulls last`,
      );
      expect(rows).toEqual([
        { email: 'sales-rep-other@demo.local', n: '5' },
        { email: 'sales-rep@demo.local', n: '6' },
        { email: null, n: '1' },
      ]);
      // An assignee the join did not find would read as "nobody" above.
      const assigned = await query<{ n: string }>(
        shop,
        `select count(*)::text as n from crm_opportunities where assigned_admin_user_id is not null`,
      );
      expect(assigned[0]!.n).toBe('11');
    });

    it('gives every Opportunity a history that ends where it stands', async () => {
      // The analytics read `crm_opportunity_status_history` and the three dates
      // on the row itself, and nothing checks that the two agree — a Command
      // writes both in one transaction, and this step writes them by hand.
      const rows = await query<{
        number: string;
        status_code: string;
        kind: string;
        closed_kind: string | null;
        closed_at: Date | null;
        created_at: Date;
        first_cause: string;
        first_at: Date;
        last_status: string;
        last_at: Date;
        ordered: boolean;
        in_future: boolean;
      }>(
        shop,
        `select c.number, c.status_code, s.kind, c.closed_kind, c.closed_at, c.created_at,
                (select h.cause from crm_opportunity_status_history h
                  where h.opportunity_id = c.id order by h.changed_at limit 1) as first_cause,
                (select min(h.changed_at) from crm_opportunity_status_history h
                  where h.opportunity_id = c.id) as first_at,
                (select h.to_status_code from crm_opportunity_status_history h
                  where h.opportunity_id = c.id order by h.changed_at desc limit 1) as last_status,
                (select max(h.changed_at) from crm_opportunity_status_history h
                  where h.opportunity_id = c.id) as last_at,
                not exists (
                  select 1 from crm_opportunity_status_history h
                    join crm_opportunity_status_history n
                      on n.opportunity_id = h.opportunity_id
                     and n.from_status_code = h.to_status_code
                   where h.opportunity_id = c.id and n.changed_at <= h.changed_at
                ) as ordered,
                (c.updated_at > now() or c.created_at > now()) as in_future
           from crm_opportunities c
           join crm_opportunity_statuses s on s.code = c.status_code
          order by c.number`,
      );
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.number).toMatch(/^OPP-\d{6}$/);
        expect(row.first_cause, row.number).toBe('created');
        expect(row.first_at.getTime(), row.number).toBe(row.created_at.getTime());
        expect(row.last_status, row.number).toBe(row.status_code);
        expect(row.ordered, row.number).toBe(true);
        expect(row.in_future, row.number).toBe(false);
        expect(row.closed_kind, row.number).toBe(row.kind === 'open' ? null : row.kind);
        expect(row.closed_at?.getTime() ?? null, row.number).toBe(
          row.kind === 'open' ? null : row.last_at.getTime(),
        );
      }
      expect(new Set(rows.map((row) => row.number)).size).toBe(12);

      const spread = await query<{ days: string }>(
        shop,
        `select extract(day from now() - min(created_at))::text as days from crm_opportunities`,
      );
      // About three months of pipeline, so no analytics period is empty.
      expect(Number(spread[0]!.days)).toBeGreaterThan(60);
    });

    it('values the pipeline by hand, bar the one that waits for its documents', async () => {
      const rows = await query<{ value_mode: string; n: string; valued: string; computed: string }>(
        shop,
        `select value_mode, count(*)::text as n, count(manual_value)::text as valued,
                sum(computed_value)::text as computed
           from crm_opportunities group by value_mode order by value_mode`,
      );
      // Calculated from linked Orders and Quote Requests, and the demo links
      // none — so the calculated figure is zero, and saying anything else here
      // would be a number the next recalculation takes away.
      expect(rows).toEqual([
        { value_mode: 'computed', n: '1', valued: '0', computed: '0.00' },
        { value_mode: 'manual', n: '11', valued: '11', computed: '0.00' },
      ]);
      const links = await query<{ n: string }>(
        shop,
        `select count(*)::text as n from crm_opportunity_links`,
      );
      expect(links[0]!.n).toBe('0');
    });

    it('joins the pipeline to rows that exist: tags, the contact, the channel and what a text names', async () => {
      const [row] = await query<{
        tags: string;
        contacts: string;
        foreign_contacts: string;
        channels: string;
        authors: string;
      }>(
        shop,
        `select
           (select string_agg(distinct t.name, ', ' order by t.name)
              from crm_opportunity_tags j join crm_tags t on t.id = j.tag_id) as tags,
           (select count(*) from crm_opportunities c
              join customer_accounts a on a.id = c.customer_account_id
             where a.email = 'buyer@demo-org.example')::text as contacts,
           (select count(*) from crm_opportunities c
              join customer_accounts a on a.id = c.customer_account_id
             where a.organization_id <> c.organization_id)::text as foreign_contacts,
           (select string_agg(distinct ch.code, ', ' order by ch.code)
              from crm_opportunities c join sales_channels ch on ch.id = c.sales_channel_id) as channels,
           (select count(*) from crm_opportunity_comments m
              join admin_users u on u.id = m.author_admin_user_id)::text as authors`,
      );
      expect(row).toEqual({
        tags: 'Key account, Tender, Upsell',
        contacts: '4',
        foreign_contacts: '0',
        channels: 'pl_b2b_vip, pl_retail',
        authors: '6',
      });

      // Each reference is an index entry derived from a text: the text carries
      // the token, and the token names a row that is there.
      const references = await query<{
        source_kind: string;
        target_type: string;
        carried: boolean;
        resolves: boolean;
      }>(
        shop,
        `select r.source_kind, r.target_type,
                position('[[' || r.target_type || ':' || r.target_id || ']]' in
                  case when r.source_kind = 'comment'
                       then (select m.body from crm_opportunity_comments m where m.id = r.source_id)
                       else (select c.description from crm_opportunities c where c.id = r.opportunity_id)
                  end) > 0 as carried,
                case r.target_type
                  when 'product' then exists (select 1 from products p where p.id = r.target_id)
                  when 'admin_user' then exists (select 1 from admin_users u where u.id = r.target_id)
                  else false
                end as resolves
           from crm_opportunity_references r
          order by r.source_kind, r.target_type`,
      );
      expect(references).toEqual([
        { source_kind: 'comment', target_type: 'admin_user', carried: true, resolves: true },
        { source_kind: 'comment', target_type: 'product', carried: true, resolves: true },
        { source_kind: 'description', target_type: 'product', carried: true, resolves: true },
      ]);
    });

    it('plans Events on the open Opportunities, dated from the day of the seed, and none with a reminder', async () => {
      const [row] = await query<{
        on_closed: string;
        reminders: string;
        handled: string;
        all_day: string;
        whole_days: string;
        past: string;
        earliest_days: string;
        latest_days: string;
        opportunities: string;
        authors: string;
      }>(
        shop,
        `select
           (select count(*) from crm_opportunity_events e
              join crm_opportunities c on c.id = e.opportunity_id
              join crm_opportunity_statuses s on s.code = c.status_code
             where s.kind <> 'open')::text as on_closed,
           (select count(*) from crm_opportunity_events where remind_at is not null)::text as reminders,
           (select count(*) from crm_opportunity_events
             where reminder_handled_at is not null or reminder_outcome is not null)::text as handled,
           (select count(*) from crm_opportunity_events where all_day)::text as all_day,
           (select count(*) from crm_opportunity_events
             where all_day and time_zone = 'UTC'
               and starts_at = date_trunc('day', starts_at at time zone 'UTC') at time zone 'UTC'
               and ends_at = starts_at + interval '1 day')::text as whole_days,
           (select count(*) from crm_opportunity_events where ends_at < now())::text as past,
           (select extract(day from date_trunc('day', now() at time zone 'UTC')
                     - date_trunc('day', min(starts_at) at time zone 'UTC'))
              from crm_opportunity_events)::text as earliest_days,
           (select extract(day from date_trunc('day', max(starts_at) at time zone 'UTC')
                     - date_trunc('day', now() at time zone 'UTC'))
              from crm_opportunity_events)::text as latest_days,
           (select count(distinct opportunity_id) from crm_opportunity_events)::text as opportunities,
           (select count(*) from crm_opportunity_events e
              join admin_users u on u.id = e.created_by_admin_user_id)::text as authors`,
      );
      expect(row).toEqual({
        // The Calendar shows active Opportunities only; a closed one has none to hide.
        on_closed: '0',
        // A demo must not start writing bell entries and e-mails a day after it was installed.
        reminders: '0',
        handled: '0',
        all_day: '2',
        whole_days: '2',
        // One that has already happened, for the tab's second list.
        past: '1',
        earliest_days: '5',
        latest_days: '12',
        opportunities: '6',
        authors: '8',
      });
    });

    it('reports the pipeline step, and `crm` among the modules that seeded', () => {
      const report = seedReports[0]!;
      expect(report).toContain('  sales opportunities for the demo organisation');
      expect(report).toMatch(/^ {2}crm — .*\(.*CrmTag.*3.*\)$/m);
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
      // The one thing a count cannot hold still — the escape-hatch access
      // records every composing process appends — is read by the access ledger
      // above instead of being excepted here.
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

    it('leaves no row of the pipeline behind, and CRM’s workflow where it was', () => {
      // Said outright rather than left to the ledger above, because it is the
      // property an operator asks about: after a reset there is no demo
      // Opportunity, no trace of one, and no demo tag.
      for (const table of [
        'crm_opportunities',
        'crm_opportunity_status_history',
        'crm_opportunity_tags',
        'crm_opportunity_comments',
        'crm_opportunity_references',
        'crm_opportunity_events',
        'crm_opportunity_links',
        'crm_opportunity_attachments',
        'crm_status_propagations',
        'crm_tags',
      ]) {
        expect(afterReset[table], table).toBe(0);
      }
      // The six statuses and their transitions are the module's own migration's
      // and the operator's, not the demo's.
      expect(afterReset['crm_opportunity_statuses']).toBe(6);
      expect(afterReset['crm_opportunity_statuses']).toBe(afterThird['crm_opportunity_statuses']);
      expect(afterReset['crm_opportunity_status_transitions']).toBe(
        baseline['crm_opportunity_status_transitions'],
      );
      expect(afterReset['crm_order_status_mappings']).toBe(0);
      expect(afterThird['crm_order_status_mappings']).toBe(0);
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
