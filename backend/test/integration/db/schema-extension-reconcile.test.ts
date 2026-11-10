import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SchemaExtensionReconcileError,
  migrateUpVerified,
  schemaExtensionMigrationName,
} from '@endora-commerce/platform/db';

import {
  DECLARING_MODULE,
  HOST_TABLE,
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/** The reconcile's refusal, unwrapped from umzug's `MigrationError`. */
function reconcileRefusal(error: unknown): SchemaExtensionReconcileError {
  const cause = (error as { cause?: unknown }).cause ?? error;
  expect(cause).toBeInstanceOf(SchemaExtensionReconcileError);
  return cause as SchemaExtensionReconcileError;
}

/**
 * `specs/178-extensible-columns/` FR-020 – FR-024 (tasks.md T020) — the
 * generated step reconciles the declarations with the `schema_extensions`
 * ledger, additively, inside the migration transaction.
 *
 * One database for the whole file, driven forward scenario by scenario, because
 * each scenario is the next migrate run of the same instance: a declaration
 * changes, the next run reconciles it.
 */

let db: ThrowawayDatabase;

beforeAll(async () => {
  db = await throwawayDatabase();
}, 60_000);

afterAll(async () => {
  await db.drop();
});

const v1 = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
  },
});

async function up(declarations: Parameters<typeof openFixtureOrm>[1]): Promise<string[]> {
  const orm = await openFixtureOrm(db.url, declarations);
  try {
    return (await migrateUpVerified(orm)).map((m) => m.name);
  } finally {
    await orm.close(true);
  }
}

async function columns(): Promise<Record<string, { type: string; nullable: string; default: string | null }>> {
  const rows = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns ` +
      `where table_name = $1 and column_name like 'x\\_%' order by column_name`,
    [HOST_TABLE],
  );
  return Object.fromEntries(
    rows.map((r) => [r.column_name, { type: r.data_type, nullable: r.is_nullable, default: r.column_default }]),
  );
}

async function ledger(): Promise<Record<string, string>> {
  const rows = await db.query<{ physical_name: string; status: string }>(
    `select physical_name, status from schema_extensions where module_id = $1 order by physical_name`,
    [DECLARING_MODULE],
  );
  return Object.fromEntries(rows.map((r) => [r.physical_name, r.status]));
}

describe('the generated schema-extension step', () => {
  it('applies a fresh declaration: columns, the partial unique index, three ledger rows', async () => {
    const applied = await up([v1]);
    expect(applied).toContain(schemaExtensionMigrationName(DECLARING_MODULE, [v1]));
    expect(applied.indexOf(schemaExtensionMigrationName(DECLARING_MODULE, [v1]))).toBeGreaterThan(
      applied.indexOf('Migration20261110T000001FixtureHostInit'),
    );
    expect(await columns()).toEqual({
      x_acme_erp_credit_tier: { type: 'smallint', nullable: 'NO', default: '0' },
      x_acme_erp_erp_code: { type: 'character varying', nullable: 'YES', default: null },
    });
    const [index] = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'ux_x178_hosts_x_acme_erp_erp_code'`,
    );
    expect(index?.indexdef).toMatch(/CREATE UNIQUE INDEX .* WHERE \(x_acme_erp_erp_code IS NOT NULL\)/);
    expect(await ledger()).toEqual({
      ux_x178_hosts_x_acme_erp_erp_code: 'applied',
      x_acme_erp_credit_tier: 'applied',
      x_acme_erp_erp_code: 'applied',
    });
  });

  it('leaves nothing pending on a re-run with unchanged declarations (US1 scenario 5)', async () => {
    expect(await up([v1])).toEqual([]);
  });

  it('adds a newly declared key', async () => {
    const v2 = declare({ columns: { ...v1.columns, note: { type: 'text', nullable: true } } });
    expect(await up([v2])).toEqual([schemaExtensionMigrationName(DECLARING_MODULE, [v2])]);
    expect(Object.keys(await columns())).toContain('x_acme_erp_note');
    expect((await ledger())['x_acme_erp_note']).toBe('applied');
  });

  it('keeps a removed key as orphaned, column and data in place', async () => {
    await db.query(`insert into x178_hosts (id, name, x_acme_erp_note) values (gen_random_uuid(), 'a', 'kept')`);
    await up([v1]);
    expect((await ledger())['x_acme_erp_note']).toBe('orphaned');
    const [row] = await db.query<{ x_acme_erp_note: string }>(`select x_acme_erp_note from x178_hosts`);
    expect(row?.x_acme_erp_note).toBe('kept');
  });

  it('re-attaches an orphaned key declared again with the same spec', async () => {
    const v2 = declare({ columns: { ...v1.columns, note: { type: 'text', nullable: true } } });
    await up([v2]);
    expect((await ledger())['x_acme_erp_note']).toBe('applied');
  });

  it('refuses a changed spec as non-additive and rolls the run back', async () => {
    const changed = declare({
      columns: { ...v1.columns, note: { type: 'varchar', length: 10, nullable: true } },
    });
    const error = reconcileRefusal(await up([changed]).catch((caught: unknown) => caught));
    expect(error.reason).toBe('non-additive-change');
    expect(error.message).toContain('note');
    expect((await columns())['x_acme_erp_note']?.type).toBe('text');
  });

  it('adopts a matching column that exists with no ledger row', async () => {
    await db.query(`alter table x178_hosts add column x_acme_erp_adopted boolean not null default false`);
    const v3 = declare({
      columns: {
        ...v1.columns,
        note: { type: 'text', nullable: true },
        adopted: { type: 'boolean', default: false },
      },
    });
    expect(await up([v3])).toHaveLength(1);
    expect((await ledger())['x_acme_erp_adopted']).toBe('applied');
  });

  it('refuses an unledgered column whose type does not match', async () => {
    await db.query(`alter table x178_hosts add column x_acme_erp_wrong integer null`);
    const v4 = declare({
      columns: {
        ...v1.columns,
        note: { type: 'text', nullable: true },
        adopted: { type: 'boolean', default: false },
        wrong: { type: 'text', nullable: true },
      },
    });
    const error = reconcileRefusal(await up([v4]).catch((caught: unknown) => caught));
    expect(error.reason).toBe('unledgered-column-mismatch');
    expect((await ledger())['x_acme_erp_wrong']).toBeUndefined();
  });

  it('down() orphans the module rows and drops nothing (FR-023)', async () => {
    const v3 = declare({
      columns: {
        ...v1.columns,
        note: { type: 'text', nullable: true },
        adopted: { type: 'boolean', default: false },
      },
    });
    const orm = await openFixtureOrm(db.url, [v3]);
    try {
      const name = schemaExtensionMigrationName(DECLARING_MODULE, [v3]);
      await orm.getMigrator().down({ migrations: [name] });
    } finally {
      await orm.close(true);
    }
    expect(new Set(Object.values(await ledger()))).toEqual(new Set(['orphaned']));
    expect(Object.keys(await columns())).toEqual(
      expect.arrayContaining(['x_acme_erp_adopted', 'x_acme_erp_credit_tier', 'x_acme_erp_erp_code', 'x_acme_erp_note']),
    );
  });
});
