import { Migration } from '@mikro-orm/migrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SchemaExtensionDriftError,
  activeSchemaExtensionContext,
  inspectSchemaExtensions,
  migrateUpVerified,
  verifySchemaExtensions,
  type SchemaExtensionExec,
} from '@endora-commerce/platform/db';

import {
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` FR-025 – FR-027 (tasks.md T022) — the
 * verifier, at boot (read-only, on a plain connection) and inside a verified
 * migrate run (on the run's own transaction).
 */

const declaration = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
  },
});

/** A host release whose migration loses a declared column (US5 scenario 3). */
class Migration20261112T000000FixtureHostLosesColumn extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "x178_hosts" drop column if exists "x_acme_erp_credit_tier";`);
  }
}

let db: ThrowawayDatabase;

beforeAll(async () => {
  db = await throwawayDatabase();
  const orm = await openFixtureOrm(db.url, [declaration]);
  await migrateUpVerified(orm);
  await orm.close(true);
}, 60_000);

afterAll(async () => {
  await db.drop();
});

async function verifyAtBoot(): Promise<{ error: unknown; statements: string[] }> {
  const orm = await openFixtureOrm(db.url, [declaration]);
  const statements: string[] = [];
  const exec: SchemaExtensionExec = (sql, params = []) => {
    statements.push(sql);
    return orm.em.getConnection().execute(sql, params, 'all') as Promise<Record<string, unknown>[]>;
  };
  try {
    await verifySchemaExtensions(exec, activeSchemaExtensionContext(), () => {});
    return { error: undefined, statements };
  } catch (error) {
    return { error, statements };
  } finally {
    await orm.close(true);
  }
}

describe('the schema-extension verifier', () => {
  it('passes a database that carries every declared element, in two catalog reads', async () => {
    const { error, statements } = await verifyAtBoot();
    expect(error).toBeUndefined();
    expect(statements.filter((sql) => sql.includes('information_schema.columns'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('pg_indexes'))).toHaveLength(1);
    expect(statements).toHaveLength(3);
  });

  it('issues no statement at all with no declaration (inert)', async () => {
    const statements: string[] = [];
    const report = await inspectSchemaExtensions(
      async (sql) => {
        statements.push(sql);
        return [];
      },
      { declarations: [], hosts: new Map(), ownership: null },
    );
    expect(report.queries).toBe(0);
    expect(statements).toEqual([]);
  });

  it('fails a boot when a declared column was dropped by hand, naming everything (US5 scenario 2)', async () => {
    await db.query(`alter table x178_hosts drop column x_acme_erp_erp_code`);
    const { error } = await verifyAtBoot();
    expect(error).toBeInstanceOf(SchemaExtensionDriftError);
    const message = (error as Error).message;
    expect(message).toContain('module "acme_erp"');
    expect(message).toContain('key "erpCode"');
    expect(message).toContain('"x_acme_erp_erp_code"');
    expect(message).toContain('"x178_hosts"');
    expect(message).toContain('last executed migration of "fixture_host": Migration20261110T000001FixtureHostInit');
    const kinds = (error as SchemaExtensionDriftError).drift.map((d) => d.kind).sort();
    // The unique index went with the column.
    expect(kinds).toEqual(['missing-column', 'missing-index']);
    await db.query(`alter table x178_hosts add column x_acme_erp_erp_code varchar(64) null`);
    await db.query(
      `create unique index ux_x178_hosts_x_acme_erp_erp_code on x178_hosts (x_acme_erp_erp_code) where x_acme_erp_erp_code is not null`,
    );
    expect((await verifyAtBoot()).error).toBeUndefined();
  });

  it('fails a boot on a wrong-typed column', async () => {
    await db.query(`alter table x178_hosts alter column x_acme_erp_credit_tier type integer`);
    const { error } = await verifyAtBoot();
    expect(error).toBeInstanceOf(SchemaExtensionDriftError);
    expect((error as SchemaExtensionDriftError).drift).toEqual([
      expect.objectContaining({ kind: 'column-mismatch', key: 'creditTier', detail: expect.stringContaining('int4') }),
    ]);
    await db.query(`alter table x178_hosts alter column x_acme_erp_credit_tier type smallint`);
  });

  it('fails a boot on a missing index', async () => {
    await db.query(`drop index ux_x178_hosts_x_acme_erp_erp_code`);
    const { error } = await verifyAtBoot();
    expect((error as SchemaExtensionDriftError).drift).toEqual([
      expect.objectContaining({ kind: 'missing-index', physicalName: 'ux_x178_hosts_x_acme_erp_erp_code' }),
    ]);
    await db.query(
      `create unique index ux_x178_hosts_x_acme_erp_erp_code on x178_hosts (x_acme_erp_erp_code) where x_acme_erp_erp_code is not null`,
    );
  });

  it('rolls a migrate run back when a migration in it loses a declared column (US5 scenario 3)', async () => {
    const orm = await openFixtureOrm(db.url, [declaration], {
      hostMigrations: [Migration20261112T000000FixtureHostLosesColumn],
    });
    try {
      await expect(migrateUpVerified(orm)).rejects.toBeInstanceOf(SchemaExtensionDriftError);
    } finally {
      await orm.close(true);
    }
    const [column] = await db.query(
      `select 1 from information_schema.columns where table_name = 'x178_hosts' and column_name = 'x_acme_erp_credit_tier'`,
    );
    expect(column).toBeDefined();
    const executed = await db.query<{ name: string }>(`select name from mikro_orm_migrations`);
    expect(executed.map((r) => r.name)).not.toContain('Migration20261112T000000FixtureHostLosesColumn');
  });
});
