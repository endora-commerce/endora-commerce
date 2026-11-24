import { randomUUID } from 'node:crypto';

import { Migration } from '@mikro-orm/migrations';
import { raw } from '@mikro-orm/postgresql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForeignSchemaWriteError, migrateUpVerified } from '@endora-commerce/platform/db';

import {
  HOST_TABLE,
  ORG_HOST_TABLE,
  X178Host,
  declare,
  openFixtureOrm,
  revertMigration,
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
        await self.execute(`delete from "${HOST_TABLE}" where "name" = 'rogue'`);
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
        await self.getEntityManager().getConnection().execute(`delete from "${HOST_TABLE}" where "name" = 'rogue'`);
      },
    ],
    // Issue #1864 — the routes raw SQL moved to off `getKnex()`: `?` values,
    // a `??` identifier, a fragment as a value, and a transaction of its own
    // on the connection API.
    [
      'execute() with ? values',
      async (self: Migration) => {
        await self.getEntityManager().execute(`delete from "${HOST_TABLE}" where "name" = ?`, ['rogue']);
      },
    ],
    [
      'execute() with the table as a ?? identifier',
      async (self: Migration) => {
        await self.getEntityManager().execute('delete from ?? where "name" = ?', [HOST_TABLE, 'rogue']);
      },
    ],
    [
      'execute() with the table handed in as a SQL fragment',
      async (self: Migration) => {
        await self.getEntityManager().execute('delete from ? where "name" = ?', [raw(`"${HOST_TABLE}"`), 'rogue']);
      },
    ],
    [
      'getConnection().transactional() + execute(…, trx)',
      async (self: Migration) => {
        const connection = self.getEntityManager().getConnection();
        await connection.transactional(async (trx) => {
          await connection.execute(`delete from "${HOST_TABLE}" where "name" = ?`, ['rogue'], 'run', trx);
        });
      },
    ],
    [
      'fork().nativeDelete()',
      async (self: Migration) => {
        await self.getEntityManager().fork().nativeDelete(X178Host, { name: 'rogue' });
      },
    ],
  ])('refuses a foreign write through %s', async (_label, up) => {
    const error = await migrate(packageMigration('Migration20261201T100006AcmeErpRogue', up));
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
  });

  // D-291 R-A6 (T071) — the down() a hard uninstall runs may not destroy a table
  // another module's entity maps, even one its up() created if not exists.
  it('refuses the revert that would drop another module’s table, and the table survives', async () => {
    class Migration20261201T100059AcmeErpBridge extends Migration {
      override async up(): Promise<void> {
        this.addSql(`create table if not exists "${ORG_HOST_TABLE}" ("id" uuid primary key)`);
      }
      override async down(): Promise<void> {
        this.addSql(`drop table if exists "${ORG_HOST_TABLE}" cascade`);
      }
    }
    const orm = await openFixtureOrm(db.url, [onHost], { packageMigrations: [Migration20261201T100059AcmeErpBridge] });
    try {
      await migrateUpVerified(orm);
      const error = await revertMigration(orm, 'Migration20261201T100059AcmeErpBridge').then(
        () => null,
        (caught: unknown) => (caught as { cause?: unknown }).cause ?? caught,
      );
      expect(error).toBeInstanceOf(ForeignSchemaWriteError);
      expect(error).toMatchObject({ table: ORG_HOST_TABLE, direction: 'down' });
      expect(await db.query(`select to_regclass('${ORG_HOST_TABLE}') as t`)).toEqual([{ t: ORG_HOST_TABLE }]);
    } finally {
      await orm.close(true);
    }
  });
});

/**
 * Issue #1860 (part of #1073). This pins the guard's refusals of raw database
 * handles, and it must stay green after the move to MikroORM 7.
 *
 * Today the raw handle is knex (`getKnex`). #1864 moves raw SQL off it, and
 * MikroORM 7 offers kysely (`getKysely`) instead. So the routes are data and the
 * assertion is not: when the access path changes, change or add rows in
 * {@link RAW_ACCESS_ROUTES} and leave {@link expectRawAccessRefused} alone. A
 * route must be refused with the guard's own error, and the row it tried to
 * delete must still be there afterwards. That second check is what tells a
 * refusal apart from a handle that ran its SQL on a connection of its own,
 * outside the migration's transaction, and then failed for some other reason.
 */
describe('the foreign-schema guard on raw database handles (#1860)', () => {
  /** `fixture_host`'s row the rogue package tries to delete. */
  class Migration20261110T000003FixtureHostSeed extends Migration {
    override async up(): Promise<void> {
      this.addSql(`insert into "${HOST_TABLE}" ("id", "name") values ('${randomUUID()}', 'rogue')`);
    }
  }

  type RawAccessRoute = readonly [label: string, attempt: (self: Migration) => Promise<unknown>];
  const deleteRogue = (handle: unknown): Promise<unknown> =>
    (handle as (table: string) => { where(w: object): { delete(): Promise<unknown> } })(HOST_TABLE)
      .where({ name: 'rogue' })
      .delete();

  const RAW_ACCESS_ROUTES: readonly RawAccessRoute[] = [
    ['getEntityManager().getKnex()', (self) => deleteRogue(self.getEntityManager().getKnex())],
    ['getEntityManager().getConnection().getKnex()', (self) => deleteRogue(self.getEntityManager().getConnection().getKnex())],
    ['getEntityManager().fork().getKnex()', (self) => deleteRogue(self.getEntityManager().fork().getKnex())],
    [
      'getEntityManager().transactional(em => em.getKnex())',
      (self) => self.getEntityManager().transactional((em) => deleteRogue(em.getKnex())),
    ],
  ];

  const rogueRows = async (): Promise<number> =>
    (await db.query<{ n: number }>(`select count(*)::int as n from "${HOST_TABLE}" where "name" = 'rogue'`))[0]!.n;

  async function expectRawAccessRefused(attempt: RawAccessRoute[1]): Promise<void> {
    const seeded = await openFixtureOrm(db.url, [onHost], { hostMigrations: [Migration20261110T000003FixtureHostSeed] });
    try {
      await migrateUpVerified(seeded);
    } finally {
      await seeded.close(true);
    }
    expect(await rogueRows()).toBe(1);

    const rogue = packageMigration('Migration20261201T100045AcmeErpRawAccess', async (self) => {
      await attempt(self);
    });
    const orm = await openFixtureOrm(db.url, [onHost], {
      hostMigrations: [Migration20261110T000003FixtureHostSeed],
      packageMigrations: [rogue],
    });
    let error: unknown = null;
    try {
      await migrateUpVerified(orm);
    } catch (caught) {
      error = (caught as { cause?: unknown }).cause ?? caught;
    } finally {
      await orm.close(true);
    }
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
    expect(await rogueRows(), 'the raw handle ran its delete').toBe(1);
    expect(await executed()).not.toContain('Migration20261201T100045AcmeErpRawAccess');
  }

  it.each(RAW_ACCESS_ROUTES)('refuses %s, and the row survives', async (_label, attempt) => {
    await expectRawAccessRefused(attempt);
  });

  /**
   * Open (#1889): raw database handles the guard does not wrap yet. They hold
   * the same assertion and fail it today; when #1889 closes them, `it.fails`
   * turns red and the row moves into {@link RAW_ACCESS_ROUTES}.
   */
  const OPEN_RAW_ACCESS_ROUTES: readonly RawAccessRoute[] = [
    ['this.getKnex() builder', (self) => deleteRogue(self.getKnex())],
    [
      'this.getKnex().raw()',
      (self) =>
        (self.getKnex() as unknown as { raw(sql: string): Promise<unknown> }).raw(
          `delete from "${HOST_TABLE}" where "name" = 'rogue'`,
        ),
    ],
    [
      'this.getEntityManager().getDriver().execute()',
      (self) => self.getEntityManager().getDriver().execute(`delete from "${HOST_TABLE}" where "name" = 'rogue'`),
    ],
    [
      'this.driver.execute()',
      (self) =>
        (self as unknown as { driver: { execute(sql: string): Promise<unknown> } }).driver.execute(
          `delete from "${HOST_TABLE}" where "name" = 'rogue'`,
        ),
    ],
  ];

  it.fails.each(OPEN_RAW_ACCESS_ROUTES)('open (#1889): refuses %s, and the row survives', async (_label, attempt) => {
    await expectRawAccessRefused(attempt);
  });
});
