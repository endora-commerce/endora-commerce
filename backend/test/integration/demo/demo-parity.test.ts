/**
 * The two demo seeds produce the same shop (feature 113, T210).
 *
 * `pnpm --filter backend run seed:dev` and `endora demo seed` are seeded into
 * **two throwaway databases cloned from one migrated template**, and the two
 * databases are then compared. This is the only ratchet Phase 1 has for what it
 * actually changes: `backend/src/seeds/` is in no module walk root, so
 * `check:module-boundary` sees neither the seed's relative `dist` entity
 * reaches nor its raw-SQL sites, and no other check's population contains the
 * file. Nothing static can judge whether the composition produces the right
 * shop — this does, by producing both and diffing them.
 *
 * **It is written before the first block moves, and it is red until T211
 * lands**, because `endora demo seed` seeds nothing today. A split measured
 * after the fact is a split nobody measured.
 *
 * ## What is compared, and why it is deltas over a derived population
 *
 * **The two paths do not start from the same place, and nothing in this
 * feature's artefacts said so.** `endora demo seed` composes the platform
 * before it seeds, so a boot runs first and its reconcilers write — measured on
 * a freshly migrated database, one boot inserts 72 module registrations, 303
 * settings, 62 setting groups, 73 countries, 52 currencies, 60 dictionary
 * translations, 8 562 product-feed taxonomy nodes and a system-default sales
 * channel. `seed:dev` composes nothing and writes none of them. An absolute
 * whole-database comparison between a booted path and an unbooted one measures
 * the boot, not the demo.
 *
 * So: **both databases are put through one `endora demo reset` first**, which
 * boots and withdraws, and what is compared is the **delta** each seed then
 * produces. The population is derived rather than listed — it is every table
 * whose count the *reference* run moved — so a table the demo starts writing
 * joins the comparison by being written, and a table only the platform's boot
 * touches is out of it because the reference never touches it. A list of tables
 * here would be a derived fact written down (D-100), and the tables this seed
 * writes were miscounted twice in this feature's own artefacts before a line of
 * it was implemented.
 *
 * The second layer is the one that catches a **faithful count of the wrong
 * rows**: ordered content fingerprints over natural keys, one group per
 * composition step. Row ids cannot appear in either layer — the seed mints
 * `crypto.randomUUID()` for assets, gallery items and every composite's wiring,
 * and MikroORM mints one per product — so every fingerprint is keyed on a SKU,
 * a slug, a code or an e-mail.
 *
 * **`SEED_PRODUCT_101_ID` and its siblings are not in scope, and the task list
 * that asked for them was wrong about where they come from.** They are declared
 * by `backend/test/helpers/seed-catalog.ts`' `seedUs1Catalog`, the *test*
 * fixture; the dev seed writes no fixed product id at all (two fixed UUIDs are
 * in the file, the Kraków warehouse and the default attribute set, and both are
 * reached below by their natural key).
 *
 * ## Why it is an integration test rather than an acceptance script
 *
 * Constitution III defines this tree as the one that exercises the real
 * database, and that is exactly what the subject is. The alternative shape —
 * `backend/scripts/acceptance/`, as `package-schema` takes — buys a CI job of
 * its own and costs a package script, a `gate-coverage` classification, an
 * entry-scope program and a read-size record, none of which makes the
 * comparison stronger. The cost of this shape is that no merge-request pipeline
 * runs it (D-198); the nightly `master` suite does.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** ~90 s of migrations plus two full seeds, in one file. */
const SUITE_TIMEOUT_MS = 600_000;

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
      'demo parity: DATABASE_URL is not set. This test provisions its own throwaway ' +
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
          `demo parity: ${label} exited ${signal === null ? `with code ${code}` : `on ${signal}`}.\n` +
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
 * the comparison by existing. `mikro_orm_migrations` is excluded because both
 * databases are clones of the same migrated template and its content is the
 * template's, not either seed's.
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
 * The content fingerprints, one per thing the composition is responsible for
 * plus the identities it hangs off.
 *
 * Each is an ordered projection over natural keys. Ordering is in SQL and total
 * — a fingerprint whose order depends on the table's physical layout compares
 * two shuffles of the same rows as different shops, which is a false red, and a
 * fingerprint with no order at all is one that cannot see a reordering, which
 * is a false green.
 */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  // ── the shop the modules write ─────────────────────────────────────────
  sales_channels: `select code, is_public, system_default, default_language, default_currency,
                          languages, currencies, active, status
                     from sales_channels order by code`,
  categories: `select c.slug, p.slug as parent_slug, c.name->>'en-US' as name_en
                 from categories c left join categories p on p.id = c.parent_category_id
                order by c.slug`,
  products: `select sku, slug, type, status, visibility, name->>'en-US' as name_en,
                    md5(coalesce(description->>'en-US', '')) as description_digest,
                    attribute_values
               from products order by sku`,
  taxes: `select code, name, rate, country, is_default from taxes order by code`,
  delivery_methods: `select code, cost, currency, adapter from delivery_methods order by code`,
  payment_methods: `select code, kind, adapter, status_on_pending, status_on_success,
                           status_on_failure
                      from payment_methods order by code`,
  admin_roles: `select code, name, permissions from admin_roles order by code`,
  admin_users: `select u.email, u.first_name, u.last_name, u.status, r.code as role_code
                  from admin_users u join admin_roles r on r.id = u.admin_role_id
                 order by u.email`,
  organizations: `select name, tax_id, status, vat_status from organizations order by tax_id`,
  warehouses: `select code, name, active from warehouses order by code`,
  assets: `select kind, filename, mime_type, size_bytes from assets order by filename`,
  custom_field_definitions: `select entity_type, key, label_default, value_type, sort_order
                               from custom_field_definitions
                              where entity_type = 'product' order by key`,

  // ── step 1 — the megamenu over the category tree ───────────────────────
  megamenus: `select name, description from megamenus order by name`,
  megamenu_items: `select i.kind, i.position, i.labels, c.slug as target_slug,
                          parent_c.slug as parent_target_slug
                     from megamenu_items i
                     left join categories c on c.id = (i.target->>'categoryId')::uuid
                     left join megamenu_items p on p.id = i.parent_id
                     left join categories parent_c
                            on parent_c.id = (p.target->>'categoryId')::uuid
                    order by parent_c.slug nulls first, i.position, c.slug`,
  megamenu_bindings: `select ch.code as channel_code, b.language, b.active
                        from megamenu_bindings b
                        join sales_channels ch on ch.id = b.sales_channel_id
                       order by ch.code, b.language`,

  // ── step 2 — the product↔category and channel↔product bridges ──────────
  product_categories: `select p.sku, c.slug
                         from product_categories pc
                         join products p on p.id = pc.product_id
                         join categories c on c.id = pc.category_id
                        order by p.sku, c.slug`,
  sales_channel_products: `select ch.code, p.sku
                             from sales_channel_products scp
                             join sales_channels ch on ch.id = scp.sales_channel_id
                             join products p on p.id = scp.product_id
                            order by ch.code, p.sku`,

  // ── step 3 — the price-list backfill ───────────────────────────────────
  price_lists: `select code, name, currency, is_default, type, status, is_system
                  from price_lists order by code`,
  price_list_items: `select l.code, p.sku, i.mode, i.min_quantity, i.unit_price,
                            i.adjustment_value
                       from price_list_items i
                       join price_lists l on l.id = i.price_list_id
                       join products p on p.id = i.product_id
                      order by l.code, p.sku, i.min_quantity`,
  price_list_products: `select l.code, p.sku
                          from price_list_products x
                          join price_lists l on l.id = x.price_list_id
                          join products p on p.id = x.product_id
                         order by l.code, p.sku`,
  price_list_price_brackets: `select l.code, p.sku, b.currency_code, b.min_quantity,
                                     b.max_quantity, b.amount
                                from price_list_price_brackets b
                                join price_lists l on l.id = b.price_list_id
                                join products p on p.id = b.product_id
                               order by l.code, p.sku, b.currency_code, b.min_quantity`,

  // ── step 4 — the stock spread ──────────────────────────────────────────
  // No `on_hand`, and that is a finding rather than a concession: the demo's
  // quantity is `50 + (parseInt(product.id.slice(0,8), 16) % 200)`, derived
  // from a **random** UUID MikroORM mints per row, so no two runs of the demo
  // seed — on any path — produce the same stock. What is comparable is which
  // product is stocked in which warehouse; the 60/40 split itself is asserted
  // per side below, where it is decidable.
  stock_levels: `select p.sku, w.code as warehouse_code, s.reserved
                   from stock_levels s
                   join products p on p.id = s.product_id
                   join warehouses w on w.id = s.warehouse_id
                  order by p.sku, w.code`,
  warehouse_channel_assignments: `select w.code as warehouse_code, ch.code as channel_code,
                                         a.is_default, a.sort_order
                                    from warehouse_channel_assignments a
                                    join warehouses w on w.id = a.warehouse_id
                                    join sales_channels ch on ch.id = a.sales_channel_id
                                   order by w.code, ch.code`,

  // ── step 5 — the buyer↔organisation membership ─────────────────────────
  customer_accounts: `select a.email, a.first_name, a.last_name, a.role, o.tax_id as org_tax_id,
                             (a.password_hash is not null) as has_password,
                             (a.password_set_at is not null) as password_stamped,
                             (a.email_verified_at is not null) as verified
                        from customer_accounts a
                        left join organizations o on o.id = a.organization_id
                       order by a.email`,
  credit_limits: `select o.tax_id, l.granted_amount, l.currency
                    from credit_limits l
                    join organizations o on o.id = l.organization_id
                   order by o.tax_id`,

  // ── the catalog's own wiring, which no step owns and every step assumes ─
  product_assets: `select p.sku, a.filename, pa.position
                     from product_assets pa
                     join products p on p.id = pa.product_id
                     join assets a on a.id = pa.asset_id
                    order by p.sku, pa.position`,
  gallery_items: `select p.sku, a.filename, g.position
                    from gallery_items g
                    join products p on p.id = g.product_id
                    join assets a on a.id = g.asset_id
                   order by p.sku, g.position`,
  gallery_item_labels: `select p.sku, l.label
                          from gallery_item_labels l
                          join products p on p.id = l.product_id
                         order by p.sku, l.label`,
  product_attachments: `select p.sku, t.code as attachment_type, at.name, at.position
                          from product_attachments at
                          join products p on p.id = at.product_id
                          join attachment_types t on t.id = at.attachment_type_id
                         order by p.sku, at.position`,
  grouped_items: `select parent.sku as parent_sku, child.sku as child_sku, g.quantity, g.position
                    from grouped_items g
                    join products parent on parent.id = g.parent_product_id
                    join products child on child.id = g.child_product_id
                   order by parent.sku, g.position`,
  bundle_slots: `select p.sku, s.name, s.min_quantity, s.max_quantity, s.position
                   from bundle_slots s
                   join products p on p.id = s.parent_product_id
                  order by p.sku, s.position`,
  bundle_slot_options: `select parent.sku as parent_sku, option.sku as option_sku,
                               o.default_quantity, o.position
                          from bundle_slot_options o
                          join bundle_slots s on s.id = o.slot_id
                          join products parent on parent.id = s.parent_product_id
                          join products option on option.id = o.option_product_id
                         order by parent.sku, o.position`,
};

/**
 * What the **composed** path holds that `seed:dev` cannot, and why.
 *
 * `endora demo seed` boots the platform before it seeds, so the boot hooks run
 * once more after the shop exists and reconcile themselves to it. None of these
 * rows is the demo's: they are the platform catching up with a channel and a
 * catalogue that, on the `seed:dev` path, appear after the last boot and are
 * therefore never reconciled at all. That asymmetry is the composed path being
 * *more* complete, and it is the same hole `dev-catalog-seed.ts` already patched
 * by hand for one reconciler, with a comment beginning *"Seed runs BEFORE the
 * backend boots"*.
 *
 * It is a two-way ledger and not a filter: a table that stops being reconciled
 * fails here, and so does one that starts. Magnitudes are deliberately not
 * recorded — `cms_hook_sales_channels` is one row per shipped CMS hook and
 * moves whenever a module adds one — but for a table the reference run also
 * writes, every reference row must still be present, which is asserted below.
 */
const BOOT_RECONCILED: Readonly<Record<string, string>> = {
  admin_roles:
    "`blog` and `cms` seed a `blog_manager` and a `content_manager` role from their own " +
    'boot hooks. The demo adds `platform_admin` and `sales_representative` on both paths.',
  audit_log_entries:
    'the sales-channel reconciler records its own promotion, and the second boot has a ' +
    'channel to promote.',
  blog_categories: "`blog` seeds a default category once a sales channel exists.",
  blog_category_sales_channels: 'and binds it to that channel.',
  cms_hook_sales_channels:
    'one row per shipped CMS hook per channel — the boot binds every hook to the channel ' +
    'the demo created.',
  setting_values:
    "`invoices` pins the system-default channel to its historical numbering patterns from " +
    'its own boot hook, which needs a channel to pin.',
};

/**
 * Per product, what each warehouse holds — read for the 60/40 assertion and
 * deliberately outside `FINGERPRINTS`, since it is compared within one database
 * rather than between two.
 */
const STOCK_SPLIT = `select p.sku,
                            max(case when w.code = 'default' then s.on_hand end)::text as default_qty,
                            max(case when w.code = 'pl-krk' then s.on_hand end)::text as krakow_qty
                       from stock_levels s
                       join products p on p.id = s.product_id
                       join warehouses w on w.id = s.warehouse_id
                      group by p.sku
                     having count(*) = 2
                      order by p.sku`;

async function fingerprints(client: Client): Promise<Record<string, unknown[]>> {
  const taken: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(FINGERPRINTS)) {
    const { rows } = await client.query(sql);
    taken[name] = rows;
  }
  taken['stock_split'] = (await client.query(STOCK_SPLIT)).rows;
  return taken;
}

/** Names must fit PostgreSQL's 63-byte identifier limit and end in `_test`. */
const RUN = randomBytes(4).toString('hex');
const TEMPLATE_DB = `dp_${RUN}_tpl_test`;
const DEMO_RESET = ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'reset'];
const LEGACY_DB = `dp_${RUN}_legacy_test`;
const DEMO_DB = `dp_${RUN}_demo_test`;

describe('T210 — `seed:dev` and `endora demo seed` produce the same shop', () => {
  let legacyBefore: Record<string, number>;
  let demoBefore: Record<string, number>;
  let legacyCounts: Record<string, number>;
  let demoCounts: Record<string, number>;
  let legacyContent: Record<string, unknown[]>;
  let demoContent: Record<string, unknown[]>;

  beforeAll(async () => {
    const admin = maintenanceClient();
    await admin.connect();
    try {
      for (const database of [TEMPLATE_DB, LEGACY_DB, DEMO_DB]) {
        await admin.query(`drop database if exists "${database}"`);
      }
      await admin.query(`create database "${TEMPLATE_DB}"`);
    } finally {
      await admin.end();
    }

    // One migration run, two clones. `create database … template` is the same
    // ~1 s trick `test/global-setup.ts` uses per invocation, and it is what
    // makes the two databases provably identical before either seed touches
    // them: a second `migration:up` would be a second answer to that question.
    await run('migration:up', ['pnpm', 'exec', 'tsx', 'src/db/migrate.ts', 'up'], dsnFor(TEMPLATE_DB));

    const cloner = maintenanceClient();
    await cloner.connect();
    try {
      await cloner.query(`create database "${LEGACY_DB}" template "${TEMPLATE_DB}"`);
      await cloner.query(`create database "${DEMO_DB}" template "${TEMPLATE_DB}"`);
    } finally {
      await cloner.end();
    }

    // Both sides through one `endora demo reset` — which composes the platform,
    // so both databases hold what a boot writes before either seed runs. This
    // is what makes the deltas below comparable at all; see the header.
    await run('endora demo reset (legacy)', DEMO_RESET, dsnFor(LEGACY_DB));
    await run('endora demo reset (demo)', DEMO_RESET, dsnFor(DEMO_DB));

    const legacy = new Client({ connectionString: dsnFor(LEGACY_DB) });
    const demo = new Client({ connectionString: dsnFor(DEMO_DB) });
    await legacy.connect();
    await demo.connect();
    try {
      legacyBefore = await tableCounts(legacy);
      demoBefore = await tableCounts(demo);
    } finally {
      await legacy.end();
      await demo.end();
    }

    await run('seed:dev', ['pnpm', 'exec', 'tsx', 'src/seeds/dev-catalog-seed.ts'], dsnFor(LEGACY_DB));
    await run('endora demo seed', ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'seed'], dsnFor(DEMO_DB));

    const legacyAfter = new Client({ connectionString: dsnFor(LEGACY_DB) });
    const demoAfter = new Client({ connectionString: dsnFor(DEMO_DB) });
    await legacyAfter.connect();
    await demoAfter.connect();
    try {
      legacyCounts = await tableCounts(legacyAfter);
      demoCounts = await tableCounts(demoAfter);
      legacyContent = await fingerprints(legacyAfter);
      demoContent = await fingerprints(demoAfter);
    } finally {
      await legacyAfter.end();
      await demoAfter.end();
    }
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    const admin = maintenanceClient();
    await admin.connect();
    try {
      for (const database of [LEGACY_DB, DEMO_DB, TEMPLATE_DB]) {
        await admin.query(`drop database if exists "${database}" with (force)`);
      }
    } finally {
      await admin.end();
    }
  }, SUITE_TIMEOUT_MS);

  /** Tables the reference run moved — the demo's own population, derived. */
  function referencePopulation(): Record<string, number> {
    const moved: Record<string, number> = {};
    for (const [table, after] of Object.entries(legacyCounts)) {
      const before = legacyBefore[table];
      if (before === undefined) continue;
      if (after !== before) moved[table] = after - before;
    }
    return moved;
  }

  it('the legacy seed wrote a shop at all', () => {
    // Without this the comparison below is satisfied by two seeds that wrote
    // nothing, which is the vacuous green every ratchet in this repository is
    // written against. It asserts the *baseline*, not the subject.
    const population = referencePopulation();
    expect(Object.keys(population).length, 'seed:dev moved no table at all').toBeGreaterThan(20);
    expect(population['products']).toBe(203);
  });

  it('moves every table the reference run moves, by the same amount', () => {
    const reference = referencePopulation();
    const differing: Record<string, { legacy: number; demo: number }> = {};
    for (const [table, delta] of Object.entries(reference)) {
      if (table in BOOT_RECONCILED) continue;
      const mine = (demoCounts[table] ?? 0) - (demoBefore[table] ?? 0);
      if (mine !== delta) differing[table] = { legacy: delta, demo: mine };
    }
    expect(
      differing,
      'the two demo seeds disagree about how many rows the shop gains. Each entry is ' +
        '<table>: { legacy: seed:dev, demo: endora demo seed }, as a delta over the ' +
        'database each of them started from.',
    ).toEqual({});
  });

  it('moves no table the reference run leaves alone, beyond what the boot reconciles', () => {
    // The other direction, and it is not symmetric with the one above: a demo
    // path that writes a table `seed:dev` never touches is a shop with rows
    // nobody asked for, and the delta sweep above cannot see it — its
    // population is the reference's.
    const reference = referencePopulation();
    const extra: string[] = [];
    for (const [table, after] of Object.entries(demoCounts)) {
      if (table in reference) continue;
      const before = demoBefore[table];
      if (before !== undefined && after !== before) extra.push(table);
    }
    const declared = Object.keys(BOOT_RECONCILED).filter((table) => !(table in reference));
    expect(
      extra.sort(),
      'the composed path moved a table `seed:dev` does not, and BOOT_RECONCILED does not ' +
        'say why — or an entry in it describes a reconciliation that no longer happens.',
    ).toEqual(declared.sort());
  });

  it.each(Object.keys(FINGERPRINTS))('writes the same %s', (name) => {
    if (name in BOOT_RECONCILED) {
      // Every row the reference produced is there; the surplus is the boot's
      // and is what BOOT_RECONCILED accounts for.
      const mine = demoContent[name]!.map((row) => JSON.stringify(row));
      const theirs = legacyContent[name]!.map((row) => JSON.stringify(row));
      expect(
        theirs.filter((row) => !mine.includes(row)),
        `the composed path is missing rows of ${name} that seed:dev produced`,
      ).toEqual([]);
      return;
    }
    expect(
      demoContent[name],
      `the two demo seeds disagree about ${name}'s content, at equal row counts or not`,
    ).toEqual(legacyContent[name]);
  });

  it.each([
    ['seed:dev', () => legacyContent],
    ['endora demo seed', () => demoContent],
  ])('spreads %s stock 60/40 across the two warehouses', (_label, content) => {
    // The quantities are not comparable between databases (see the
    // `stock_levels` fingerprint), so the split is asserted where it *is*
    // decidable: inside one database, against the rule the step implements.
    const rows = content()['stock_split'] as {
      sku: string;
      default_qty: string;
      krakow_qty: string;
    }[];
    expect(rows.length, 'no product carries stock in both warehouses').toBeGreaterThan(100);
    const wrong = rows.filter((row) => {
      const total = Number(row.default_qty) + Number(row.krakow_qty);
      return Number(row.default_qty) !== Math.floor(total * 0.6);
    });
    expect(wrong, 'the default warehouse does not hold 60% of the product’s stock').toEqual([]);
  });
});
