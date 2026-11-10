import { randomUUID } from 'node:crypto';

import { Migration } from '@mikro-orm/migrations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForeignSchemaWriteError, migrateUpVerified } from '@endora-commerce/platform/db';

import {
  HOST_TABLE,
  ORG_HOST_TABLE,
  X178Host,
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` FR-070, US7, SC-004 (tasks.md T063, ORM half;
 * OD-178-3) — an installed package's migration cannot write a table its module
 * does not own, through `addSql`, `execute` or `getEntityManager().flush()`, and
 * a refusal rolls the whole run back.
 *
 * The rogue package is `acme_erp` over the fixture host (`fixture_host` owns
 * `x178_hosts` and `x178_org_hosts`; the platform's real configuration path wraps
 * every `external` entry in the guard).
 */

const onHost = declare({ columns: { creditTier: { type: 'smallint', default: 0 } } });

function packageMigration(name: string, up: (self: Migration) => Promise<void> | void) {
  const cls = class extends Migration {
    override async up(): Promise<void> {
      await up(this);
    }
  };
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}

let db: ThrowawayDatabase;
beforeEach(async () => {
  db = await throwawayDatabase('x178guard');
});
afterEach(async () => {
  await db.drop();
});

async function migrate(...packageMigrations: ReturnType<typeof packageMigration>[]): Promise<unknown> {
  const orm = await openFixtureOrm(db.url, [onHost], { packageMigrations });
  try {
    await migrateUpVerified(orm);
    return null;
  } catch (error) {
    // umzug wraps what a migration threw in a `MigrationError` naming the
    // migration; the guard's refusal is its cause.
    return (error as { cause?: unknown }).cause ?? error;
  } finally {
    await orm.close(true);
  }
}

const columnsOf = async (table: string): Promise<string[]> =>
  (
    await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = $1 order by column_name`,
      [table],
    )
  ).map((row) => row.column_name);

const executed = async (): Promise<string[]> =>
  (await db.query<{ name: string }>(`select name from mikro_orm_migrations order by id`).catch(() => [])).map(
    (row) => row.name,
  );

describe('the foreign-schema guard on a real migrate', () => {
  it('refuses foreign DDL through addSql and rolls the whole run back', async () => {
    const error = await migrate(
      packageMigration('Migration20261201T100000AcmeErpRogue', (self) =>
        self.addSql(`alter table "${ORG_HOST_TABLE}" add column "foo" text`),
      ),
    );
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
    expect(error).toMatchObject({ table: ORG_HOST_TABLE, migration: 'Migration20261201T100000AcmeErpRogue' });
    expect(await columnsOf(ORG_HOST_TABLE)).toEqual([]);
    expect(await executed()).toEqual([]);
  });

  it('refuses foreign DML through execute', async () => {
    const error = await migrate(
      packageMigration('Migration20261201T100001AcmeErpRogue', async (self) => {
        await self.execute(`delete from "${HOST_TABLE}"`);
      }),
    );
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
    expect((error as ForeignSchemaWriteError).table).toBe(HOST_TABLE);
  });

  it('refuses a foreign write through getEntityManager().flush() (OD-178-3)', async () => {
    const error = await migrate(
      packageMigration('Migration20261201T100002AcmeErpRogue', async (self) => {
        const em = self.getEntityManager();
        em.create(X178Host, { id: randomUUID(), name: 'rogue' });
        await em.flush();
      }),
    );
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
    expect((error as ForeignSchemaWriteError).table).toBe(HOST_TABLE);
    expect(await db.query(`select 1 from "${HOST_TABLE}"`).catch(() => [])).toEqual([]);
  });

  it('allows the module’s back-fill of its own x_ column on its declared host', async () => {
    const error = await migrate(
      packageMigration('Migration20261201T100003AcmeErpBackfill', (self) =>
        self.addSql(`update "${HOST_TABLE}" set "x_acme_erp_credit_tier" = 2 where "name" = 'none'`),
      ),
    );
    expect(error).toBeNull();
    expect(await columnsOf(HOST_TABLE)).toContain('x_acme_erp_credit_tier');
    expect(await executed()).toContain('Migration20261201T100003AcmeErpBackfill');
  });

  it('refuses a back-fill that also sets a core column', async () => {
    const error = await migrate(
      packageMigration('Migration20261201T100004AcmeErpBackfill', (self) =>
        self.addSql(`update "${HOST_TABLE}" set "x_acme_erp_credit_tier" = 2, "name" = 'x'`),
      ),
    );
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
    expect(await columnsOf(HOST_TABLE)).not.toContain('x_acme_erp_credit_tier');
  });

  it('allows the module’s own tables', async () => {
    const error = await migrate(
      packageMigration('Migration20261201T100005AcmeErpInit', (self) => {
        self.addSql(`create table "acme_rows" ("id" uuid primary key)`);
        self.addSql(`create index "acme_rows_id_index" on "acme_rows" ("id")`);
        self.addSql(`insert into "acme_rows" ("id") values ('${randomUUID()}')`);
      }),
    );
    expect(error).toBeNull();
    expect(await columnsOf('acme_rows')).toEqual(['id']);
  });

  // Review finding 5 — the entity manager's other write paths.
  it.each([
    [
      'createQueryBuilder().update().execute()',
      async (self: Migration) => {
        await self.getEntityManager().createQueryBuilder(X178Host).update({ name: 'x' }).execute();
      },
    ],
    [
      'getConnection().execute()',
      async (self: Migration) => {
        await self.getEntityManager().getConnection().execute(`delete from "${HOST_TABLE}"`);
      },
    ],
    [
      'fork().nativeDelete()',
      async (self: Migration) => {
        await self.getEntityManager().fork().nativeDelete(X178Host, {});
      },
    ],
    [
      'getKnex()',
      async (self: Migration) => {
        await self.getEntityManager().getKnex()(HOST_TABLE).delete();
      },
    ],
  ])('refuses a foreign write through %s', async (_label, up) => {
    const error = await migrate(packageMigration('Migration20261201T100006AcmeErpRogue', up));
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
  });
});

