import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20260816T203339CoreRetireCoreActivationSettings } from '../../../src/db/migrations/20260816T203339_core_retire_core_activation_settings.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 074, FR-010a / FR-010b — the six retired activation Setting rows.
 *
 * Six modules became core in Phase 1 while carrying a live
 * `<module>.enabled` control. Dropping the manifest declaration is **not**
 * enough, and the mechanism is worth restating because both halves are
 * counter-intuitive:
 *
 *  - the settings reconciler **never deletes**. It reports a row no manifest
 *    declares as an `orphanSettings` warning and leaves it alone, deliberately,
 *    so a boot process cannot destroy an operator's stored values. Every
 *    existing database therefore keeps all six rows forever;
 *  - an orphaned activation row becomes **editable, not inert**.
 *    `SettingsAdminService.classify()` marks a row activation-protected only
 *    while `activationControlOwner(code)` matches its owner; once
 *    `settingCode` is `null` that stops matching and the row falls through to
 *    `{ editable: presenceOf(owner) ?? true, activationControl: false }`. A core
 *    module is always present, so the row would render as a live boolean on the
 *    Settings screen, labelled as the module's enablement, that changes
 *    nothing.
 *
 * The first case below is therefore the one that matters: it seeds the rows as
 * every existing deployment has them and runs the migration's own SQL against
 * them. Asserting only that a freshly built test database has none of them
 * would pass without the migration existing at all.
 */

/**
 * The six codes, written literally. This is a historical fact about what
 * feature 074 removed, not a policy list of the kind Principle XVII prohibits:
 * nothing consults it at runtime, and the distinction is exactly that.
 */
const RETIRED_CODES = [
  'audit_logs.enabled',
  'carts.enabled',
  'price_lists.enabled',
  'sales_channels.enabled',
  'settings.enabled',
  'taxes.enabled',
] as const;

/** Their owners — the six modules the same change made core. */
const RETIRED_OWNERS = [
  'audit_logs',
  'carts',
  'price_lists',
  'sales_channels',
  'settings',
  'taxes',
] as const;

/** Positional placeholders for the six codes, so the list is never inlined. */
const PLACEHOLDERS = RETIRED_CODES.map(() => '?').join(', ');

/**
 * Raw SQL **inside the test transaction**. `em.getConnection().execute(sql)`
 * runs on the pool, outside the transaction the fixture opened, so the rollback
 * would not take the seeded rows with it — and the first run of this file left
 * six of them in the database.
 */
function sqlIn(em: EntityManager) {
  const conn = em.getConnection();
  return async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await conn.execute(sql, params, 'all', em.getTransactionContext())) as T[];
}

/**
 * The fixture is written rather than found. The test database is built from
 * migrations alone — the group and channel rows every real deployment has come
 * from the boot reconciler and the channel seed, neither of which runs here —
 * so reading "whatever group exists" would make this file pass or fail on which
 * other test ran first.
 */
async function seedGroup(run: ReturnType<typeof sqlIn>): Promise<string> {
  const id = randomUUID();
  await run(
    `insert into setting_groups (id, code, name, owner_module, created_at, updated_at)
     values (?, ?, 'Retired activation rows fixture', 'settings', now(), now())`,
    [id, `fixture_074_${id.slice(0, 8)}`],
  );
  return id;
}

/**
 * Run the migration's **own** SQL. Building the statement in the test instead
 * would assert that a literal matches a literal; this asserts that the shipped
 * migration clears the rows.
 */
async function applyMigration(
  em: EntityManager,
  run: ReturnType<typeof sqlIn>,
): Promise<void> {
  const migration = new Migration20260816T203339CoreRetireCoreActivationSettings(
    em.getDriver(),
    em.config,
  );
  migration.reset();
  await migration.up();
  const queries = migration.getQueries();
  expect(queries.length, 'the migration emitted no SQL').toBeGreaterThan(0);
  for (const query of queries) await run(query as string);
}

async function seedChannel(run: ReturnType<typeof sqlIn>): Promise<string> {
  const id = randomUUID();
  await run(
    `insert into sales_channels
       (id, code, name, is_public, default_language, default_currency, created_at, updated_at)
     values (?, ?, '{"en":"Fixture"}'::jsonb, false, 'en', 'PLN', now(), now())`,
    [id, `fx74${id.slice(0, 8)}`],
  );
  return id;
}

describe('the retired activation rows are deleted, not merely undeclared', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('leaves zero of the six behind on a database that carries all of them', async () => {
    const em = db.em();
    const run = sqlIn(em);

    // The pre-074 shape: one row per code, owned by its module. The group is
    // immaterial to the deletion — the migration keys on `code` — so a fixture
    // group carries all six.
    const groupId = await seedGroup(run);

    for (const [index, code] of RETIRED_CODES.entries()) {
      await run(
        `insert into settings
           (id, code, name, group_id, value_type, default_value, owner_module, created_at, updated_at)
         values (?, ?, ?, ?, 'boolean', 'true'::jsonb, ?, now(), now())`,
        [randomUUID(), code, `${code} (seeded)`, groupId, RETIRED_OWNERS[index]!],
      );
    }

    const seeded = await run<{ code: string }>(
      `select code from settings where code in (${PLACEHOLDERS}) order by code`,
      [...RETIRED_CODES],
    );
    expect(seeded.map((row) => row.code)).toEqual([...RETIRED_CODES]);

    await applyMigration(em, run);

    const remaining = await run<{ code: string }>(
      `select code from settings where code in (${PLACEHOLDERS})`,
      [...RETIRED_CODES],
    );
    expect(remaining).toEqual([]);
  });

  it('takes the per-channel overrides with them rather than orphaning those', async () => {
    // `setting_values` references `settings (id)` with `on delete cascade`, so
    // this needs no statement of its own — but a schema change that dropped the
    // cascade would leave rows pointing at a deleted setting, and nothing else
    // in the suite would notice.
    const em = db.em();
    const run = sqlIn(em);

    const groupId = await seedGroup(run);
    const channelId = await seedChannel(run);

    const settingId = randomUUID();
    await run(
      `insert into settings
         (id, code, name, group_id, value_type, default_value, owner_module, created_at, updated_at)
       values (?, 'carts.enabled', 'Carts enabled (seeded)', ?, 'boolean', 'true'::jsonb, 'carts', now(), now())`,
      [settingId, groupId],
    );
    await run(
      `insert into setting_values (id, setting_id, sales_channel_id, value, created_at, updated_at)
       values (?, ?, ?, 'false'::jsonb, now(), now())`,
      [randomUUID(), settingId, channelId],
    );

    await applyMigration(em, run);

    const overrides = await run<{ id: string }>(
      `select id from setting_values where setting_id = ?`,
      [settingId],
    );
    expect(overrides).toEqual([]);
  });

  it('no manifest declares any of the six, so the reconciler cannot re-create them', async () => {
    // The other half of the deletion. A migration that removed the rows while a
    // manifest still declared them would be undone by the next boot, and the
    // orphan would come back looking like an operator control again.
    const declared = new Set<string>();
    for (const entry of REGISTERED_MANIFESTS) {
      for (const setting of entry.manifest.settings?.settings ?? []) {
        declared.add(setting.code);
      }
    }
    for (const code of RETIRED_CODES) {
      expect(declared.has(code), `${code} is still declared by a manifest`).toBe(false);
    }
  });

  it('and none of the six resolves to an activation control any more', async () => {
    // FR-010b's classification invariant, at its source: `classify()` asks
    // `activationControlOwner(code)`, which reads the distilled declarations.
    // With every one of the six owners now `nonDeactivatable`, no code maps to
    // an owner — so no row carrying one could classify as an activation
    // control even if a database still held it.
    const byId = new Map(REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e.manifest]));
    for (const [index, owner] of RETIRED_OWNERS.entries()) {
      const activation = byId.get(owner)?.activation;
      expect(activation, `${owner} declares no activation block`).toBeDefined();
      expect(activation, `${owner} still owns ${RETIRED_CODES[index]}`).not.toHaveProperty(
        'settingCode',
      );
      expect(activation).toHaveProperty('nonDeactivatable', true);
    }
  });
});
