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
 * The raw handle was knex (`getKnex`) on MikroORM 6; #1864 moved raw SQL off
 * it, and MikroORM 7 (#1866) offers kysely (`getKysely`) instead. So the routes are data and the
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
  /** A kysely handle — a `Kysely` instance or a transaction — deleting the rogue row. */
  type KyselyLike = {
    deleteFrom(table: string): { where(column: string, op: string, value: unknown): { execute(): Promise<unknown> } };
  };
  const deleteRogue = (handle: unknown): Promise<unknown> =>
    (handle as KyselyLike).deleteFrom(HOST_TABLE).where('name', '=', 'rogue').execute();

  const rogueDelete = `delete from "${HOST_TABLE}" where "name" = 'rogue'`;
  type Connection = ReturnType<ReturnType<Migration['getEntityManager']>['getConnection']>;
  const connectionOf = (self: Migration): Connection => self.getEntityManager().getConnection();
  const kyselyOf = (handle: unknown): unknown => (handle as { getKysely(): unknown }).getKysely();
  const clientOf = (connection: unknown): unknown => (connection as { getClient(): unknown }).getClient();
  const driverOf = (self: Migration) =>
    (
      self as unknown as {
        driver: { execute(sql: string): Promise<unknown>; createEntityManager(): unknown; getConnection(): Connection };
      }
    ).driver;

  // MikroORM 7 (#1866): the raw handle is kysely — `getKysely()` on an entity
  // manager, `getClient()` on a connection, and a transaction is a kysely
  // transaction. MikroORM 6's knex routes (`getKnex()`) are gone with the major.
  const RAW_ACCESS_ROUTES: readonly RawAccessRoute[] = [
    ['getEntityManager().getKysely()', (self) => deleteRogue(kyselyOf(self.getEntityManager()))],
    ['getEntityManager().getConnection().getClient()', (self) => deleteRogue(clientOf(self.getEntityManager().getConnection()))],
    ['getEntityManager().fork().getKysely()', (self) => deleteRogue(kyselyOf(self.getEntityManager().fork()))],
    [
      'getEntityManager().transactional(em => em.getKysely())',
      (self) => self.getEntityManager().transactional((em) => deleteRogue(kyselyOf(em))),
    ],
    // Issue #1889 — the migration's own handles, the connection's client, and
    // the transactions a connection begins or hands a `transactional` callback.
    ['this.getKysely()', (self) => deleteRogue(kyselyOf(self))],
    ['this.getEntityManager().getDriver().execute()', (self) => self.getEntityManager().getDriver().execute(rogueDelete)],
    [
      'this.getEntityManager().getDriver().getConnection().getClient()',
      (self) => deleteRogue(clientOf(self.getEntityManager().getDriver().getConnection())),
    ],
    [
      'this.getEntityManager().getDriver().nativeDelete()',
      (self) => self.getEntityManager().getDriver().nativeDelete(X178Host, { name: 'rogue' }),
    ],
    ['this.driver.execute()', (self) => driverOf(self).execute(rogueDelete)],
    ['this.driver.getConnection().execute()', (self) => driverOf(self).getConnection().execute(rogueDelete)],
    ['this.driver.createEntityManager().nativeDelete()', async (self) => {
      const em = (await driverOf(self).createEntityManager()) as unknown as ReturnType<Migration['getEntityManager']>;
      return em.nativeDelete(X178Host, { name: 'rogue' });
    }],
    ['getConnection().getNativeClient()', async (self) => {
      const pool = (await (connectionOf(self) as unknown as { getNativeClient(): Promise<unknown> }).getNativeClient()) as {
        query(sql: string): Promise<unknown>;
      };
      return pool.query(rogueDelete);
    }],
    [
      'getConnection().begin() + trx.deleteFrom()',
      async (self) => {
        const connection = connectionOf(self);
        const trx = await connection.begin();
        try {
          return await deleteRogue(trx);
        } finally {
          await connection.rollback(trx);
        }
      },
    ],
    [
      'getConnection().begin({ ctx: this.ctx }) + trx.deleteFrom()',
      async (self) => {
        const connection = connectionOf(self);
        const trx = await connection.begin({ ctx: (self as unknown as { ctx: never }).ctx });
        try {
          return await deleteRogue(trx);
        } finally {
          await connection.rollback(trx);
        }
      },
    ],
    ['getConnection().transactional(trx => trx.deleteFrom())', (self) => connectionOf(self).transactional((trx) => deleteRogue(trx))],
    ['this.ctx', (self) => deleteRogue((self as unknown as { ctx: unknown }).ctx)],
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
   * The sanctioned routes over the same sealed handles still run, inside the
   * migration's transaction: a sealed transaction is a transaction context
   * again where it re-enters the ORM.
   */
  it('still runs the sanctioned routes on a table the migration creates', async () => {
    const insert = (id: string) => `insert into "acme_raw_rows" ("id") values ('${id}')`;
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
    const error = await migrate(
      packageMigration('Migration20261201T100046AcmeErpSanctioned', async (self) => {
        const ctx = (self as unknown as { ctx: never }).ctx;
        await self.execute(`create table "acme_raw_rows" ("id" uuid primary key)`);
        const em = self.getEntityManager();
        const connection = em.getConnection();
        await connection.execute(insert(ids[0]), [], 'run', ctx);
        const trx = await connection.begin({ ctx });
        await connection.execute(insert(ids[1]), [], 'run', trx);
        await connection.commit(trx);
        await em.transactional(async (inner) => {
          await inner.getConnection().execute(insert(ids[2]), [], 'run', inner.getTransactionContext());
        });
        const fork = em.fork();
        await fork.begin({ ctx });
        await fork.find(X178Host, {});
        await fork.execute(insert(ids[3]));
        await fork.commit();
      }),
    );
    expect(error).toBeNull();
    const rows = await db.query<{ id: string }>(`select "id" from "acme_raw_rows"`);
    expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(await executed()).toContain('Migration20261201T100046AcmeErpSanctioned');
  });

  /**
   * Open (follow-up to #1889): the entity manager's transaction context is the
   * real transaction, because the ORM's own flush, loading and query builders
   * read it back through `getTransactionContext()` and hand it to the unsealed
   * driver. It holds the same assertion and fails it today; when it is sealed,
   * `it.fails` turns red and the row moves into {@link RAW_ACCESS_ROUTES}.
   *
   * Revisited on MikroORM 7 (#1866) and left open: 7.2.11 reads the context back
   * through `getTransactionContext()` in `UnitOfWork` (the flush), `EntityLoader`,
   * `Collection`, `TransactionManager` and `SqlEntityManager`, and hands it to
   * the real driver every time, so a sealed one breaks the flush the guard
   * exists to judge. On 7 the handle is a kysely transaction, which the row
   * below drives.
   */
  const OPEN_RAW_ACCESS_ROUTES: readonly RawAccessRoute[] = [
    ['getEntityManager().getTransactionContext()', (self) => deleteRogue(self.getEntityManager().getTransactionContext())],
  ];

  it.fails.each(OPEN_RAW_ACCESS_ROUTES)('open: refuses %s, and the row survives', async (_label, attempt) => {
    await expectRawAccessRefused(attempt);
  });
});
