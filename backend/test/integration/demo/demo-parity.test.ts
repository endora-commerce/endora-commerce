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
 * ## What is compared, and why it is derived rather than listed
 *
 * Two layers, and the first is a **derivation**: every base table in the
 * `public` schema of both databases is counted, so a table the seed writes that
 * nobody thought to name is compared anyway. A list of tables here would be a
 * derived fact written down (D-100) that goes stale the first time a block
 * gains a row — and the tables this seed writes were miscounted twice in this
 * feature's own artefacts before a line of it was implemented.
 *
 * The second layer is the one that catches a **faithful count of the wrong
 * rows**: ordered content fingerprints over natural keys, one per composition
 * step plus the identities. Row ids cannot appear in either layer — the seed
 * mints `crypto.randomUUID()` for assets, gallery items and every composite's
 * wiring, and MikroORM mints one per product — so every fingerprint is keyed on
 * a SKU, a slug, a code or an e-mail.
 *
 * **`SEED_PRODUCT_101_ID` and its siblings are not in scope, and the task list
 * that asked for them was wrong about where they come from.** They are declared
 * by `backend/test/helpers/seed-catalog.ts`' `seedUs1Catalog`, the *test*
 * fixture; the dev seed writes no fixed product id at all (`git grep` finds two
 * fixed UUIDs in the file, the Kraków warehouse and the default attribute set,
 * and both are asserted below by their natural key).
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

  // ── step 4 — the stock spread ──────────────────────────────────────────
  stock_levels: `select p.sku, w.code as warehouse_code, s.on_hand, s.reserved
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

async function fingerprints(client: Client): Promise<Record<string, unknown[]>> {
  const taken: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(FINGERPRINTS)) {
    const { rows } = await client.query(sql);
    taken[name] = rows;
  }
  return taken;
}

/** Names must fit PostgreSQL's 63-byte identifier limit and end in `_test`. */
const RUN = randomBytes(4).toString('hex');
const TEMPLATE_DB = `dp_${RUN}_tpl_test`;
const LEGACY_DB = `dp_${RUN}_legacy_test`;
const DEMO_DB = `dp_${RUN}_demo_test`;

describe('T210 — `seed:dev` and `endora demo seed` produce the same shop', () => {
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

    await run('seed:dev', ['pnpm', 'exec', 'tsx', 'src/seeds/dev-catalog-seed.ts'], dsnFor(LEGACY_DB));
    // `reset` then `seed`, and the pair is the subject rather than a
    // precaution. `seed:dev` opens with a 29-table `truncate … cascade`, so
    // what it produces is *the truncate's* baseline — it destroys the delivery
    // methods, payment methods and adapter rules four migrations seeded, and
    // ends at 2 payment methods where the migrated template has 15. T213
    // dissolves that truncate into `reset`, where it belongs, and the day it
    // does, a demo side that only seeded would diverge from the legacy side by
    // exactly those platform rows. Asking the demo side for `reset` + `seed` is
    // T213's own done-when — *"`endora demo reset` followed by `endora demo
    // seed` produces the database T210 compares"* — and it is what lets this
    // comparison hold still while the truncate moves.
    await run('endora demo reset', ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'reset'], dsnFor(DEMO_DB));
    await run('endora demo seed', ['pnpm', 'exec', 'tsx', 'src/cli.ts', 'demo', 'seed'], dsnFor(DEMO_DB));

    const legacy = new Client({ connectionString: dsnFor(LEGACY_DB) });
    const demo = new Client({ connectionString: dsnFor(DEMO_DB) });
    await legacy.connect();
    await demo.connect();
    try {
      legacyCounts = await tableCounts(legacy);
      demoCounts = await tableCounts(demo);
      legacyContent = await fingerprints(legacy);
      demoContent = await fingerprints(demo);
    } finally {
      await legacy.end();
      await demo.end();
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

  it('the legacy seed wrote a shop at all', () => {
    // Without this the comparison below is satisfied by two empty databases,
    // which is the vacuous green every ratchet in this repository is written
    // against. It asserts the *baseline*, not the subject.
    const written = Object.entries(legacyCounts).filter(([, count]) => count > 0);
    expect(written.length, 'seed:dev wrote no row in any table').toBeGreaterThan(20);
    expect(legacyCounts['products']).toBe(203);
  });

  it('writes the same number of rows in every table', () => {
    const differing: Record<string, { legacy: number; demo: number }> = {};
    for (const [table, count] of Object.entries(legacyCounts)) {
      const mine = demoCounts[table];
      if (mine !== count) differing[table] = { legacy: count, demo: mine ?? -1 };
    }
    for (const [table, count] of Object.entries(demoCounts)) {
      if (!(table in legacyCounts)) differing[table] = { legacy: -1, demo: count };
    }
    expect(
      differing,
      'the two demo seeds disagree about how many rows the shop has. Each entry is ' +
        '<table>: { legacy: seed:dev, demo: endora demo seed }.',
    ).toEqual({});
  });

  it.each(Object.keys(FINGERPRINTS))('writes the same %s', (name) => {
    expect(
      demoContent[name],
      `the two demo seeds disagree about ${name}'s content, at equal row counts or not`,
    ).toEqual(legacyContent[name]);
  });
});
