import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { Migration } from '@mikro-orm/migrations';
import { MikroORM, PostgreSqlPlatform, raw } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import {
  ForeignSchemaWriteError,
  dryRunStatements,
  guardExternalMigration,
  type ForeignSchemaGuardContext,
  type MigrationClass,
} from './foreign-schema-guard.js';

/**
 * `specs/178-extensible-columns/` FR-070, US7 (tasks.md T063, unit half;
 * `contracts/foreign-schema-guard.md` §1) — a package migration may write only
 * what its module owns. The ORM half (`getEntityManager().flush()`, rollback of
 * a real run) is `backend/test/integration/db/foreign-schema-guard.test.ts`.
 */

class AcmeRow {}
class AuditLogEntryLike {}

function fakeDriver(indexes: Record<string, string> = {}, existing: readonly string[] = []) {
  const executed: string[] = [];
  const platform = new PostgreSqlPlatform();
  return {
    executed,
    getPlatform: () => platform,
    getMetadata: () => ({
      getAll: () => ({
        AcmeRow: { class: AcmeRow, className: 'AcmeRow', tableName: 'acme_rows', properties: {} },
        AuditLogEntryLike: {
          class: AuditLogEntryLike,
          className: 'AuditLogEntryLike',
          tableName: 'audit_log_entries',
          properties: {},
        },
        Organization: { className: 'Organization', tableName: 'organizations', properties: {} },
      }),
    }),
    execute: vi.fn(async (sql: string, params?: unknown[]) => {
      executed.push(sql);
      if (sql.includes('to_regclass')) {
        return [{ present: existing.includes(String(params?.[0])) ? String(params?.[0]) : null }];
      }
      if (sql.includes('pg_indexes')) {
        const table = indexes[String(params?.[0])];
        return table === undefined ? [] : [{ tablename: table }];
      }
      return [];
    }),
  };
}

function context(overrides: Partial<ForeignSchemaGuardContext> = {}): ForeignSchemaGuardContext {
  return {
    moduleId: 'acme_erp',
    packageName: '@acme/mod-acme-erp',
    entities: [AcmeRow],
    platformEntities: [AuditLogEntryLike],
    declaredHosts: new Map([['organizations', new Set(['x_acme_erp_credit_tier', 'x_acme_erp_note'])]]),
    exemptions: [],
    moduleMigrations: () => [],
    ...overrides,
  };
}

function migration(name: string, up: (self: Migration) => void | Promise<void>): MigrationClass {
  const cls = class extends Migration {
    override async up(): Promise<void> {
      await up(this);
    }
  };
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}

async function run(cls: MigrationClass, ctx = context(), driver = fakeDriver()) {
  const Guarded = guardExternalMigration(cls, ctx) as unknown as new (d: unknown, c: unknown) => Migration;
  const instance = new Guarded(driver, {});
  await instance.up();
  return { instance, driver };
}

const refusal = async (promise: Promise<unknown>): Promise<ForeignSchemaWriteError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ForeignSchemaWriteError);
    return error as ForeignSchemaWriteError;
  }
  throw new Error('the migration was not refused');
};

describe('guardExternalMigration — refusals', () => {
  it('refuses foreign DDL handed to addSql, naming package, migration, table and statement', async () => {
    const cls = migration('Migration20261201T100000AcmeErpRogue', (self) =>
      self.addSql('alter table "organizations" add column "foo" text'),
    );
    const error = await refusal(run(cls));
    expect(error).toMatchObject({
      code: 'foreign-schema-write',
      packageName: '@acme/mod-acme-erp',
      moduleId: 'acme_erp',
      migration: 'Migration20261201T100000AcmeErpRogue',
      table: 'organizations',
      statement: 'alter table "organizations" add column "foo" text',
    });
  });

  it('refuses foreign DML through execute before it reaches the database', async () => {
    const driver = fakeDriver();
    const cls = migration('Migration20261201T100001AcmeErpRogue', async (self) => {
      await self.execute(`update "orders" set "status" = 'x'`);
    });
    await refusal(run(cls, context(), driver));
    expect(driver.executed.some((sql) => sql.startsWith('update'))).toBe(false);
  });

  // Issue #1864 — raw SQL moved off `getKnex()` onto `execute(sql, params)`.
  // The statement is judged as the ORM renders it, so a table named only
  // through a parameter is still a foreign write.
  it.each([
    ['delete from ?? where "name" = ?', ['orders', 'rogue']],
    ['update ?? set "status" = ? where "id" = ?', ['orders', 'x', 1]],
    ['insert into ?? (??) values (?)', ['orders', 'status', 'x']],
  ])('refuses a foreign table named through an identifier placeholder: %s', async (sql, params) => {
    const driver = fakeDriver();
    const cls = migration('Migration20261201T100009AcmeErpRogue', async (self) => {
      await self.execute(sql, params);
    });
    expect((await refusal(run(cls, context(), driver))).table).toBe('orders');
    expect(driver.executed).not.toContain(sql);
  });

  it.each([
    ['delete from ? where true', () => [raw('"orders"')]],
  ])('refuses a foreign table handed in as a SQL fragment: %s', async (sql, params) => {
    const driver = fakeDriver();
    const cls = migration('Migration20261201T100011AcmeErpRogue', async (self) => {
      await self.execute(sql, params());
    });
    expect((await refusal(run(cls, context(), driver))).table).toBe('orders');
    expect(driver.executed).not.toContain(sql);
  });

  it('allows its own table named through an identifier placeholder', async () => {
    const driver = fakeDriver();
    const cls = migration('Migration20261201T100010AcmeErpOwn', async (self) => {
      await self.execute('insert into ?? ("id") values (?)', ['acme_rows', 'a?b']);
    });
    await run(cls, context(), driver);
    expect(driver.executed).toContain('insert into ?? ("id") values (?)');
  });

  it('refuses a back-fill on a declared host that touches a core column', async () => {
    const cls = migration('Migration20261201T100002AcmeErpBackfill', (self) =>
      self.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1, "name" = 'x'`),
    );
    expect((await refusal(run(cls))).table).toBe('organizations');
  });

  it('refuses an own-prefixed update on a host the module does not declare', async () => {
    const cls = migration('Migration20261201T100003AcmeErpBackfill', (self) =>
      self.addSql(`update "orders" set "x_acme_erp_note" = 'a'`),
    );
    expect((await refusal(run(cls))).table).toBe('orders');
  });

  it('refuses a foreign write hidden in a do $$ block', async () => {
    const cls = migration('Migration20261201T100004AcmeErpRogue', (self) =>
      self.addSql(`do $$ begin if true then delete from "organizations"; end if; end $$;`),
    );
    expect((await refusal(run(cls))).table).toBe('organizations');
  });

  it('refuses dropping an index that belongs to a foreign table, resolved through the catalog', async () => {
    const cls = migration('Migration20261201T100005AcmeErpRogue', (self) =>
      self.addSql('drop index if exists "organizations_tax_id_index"'),
    );
    const driver = fakeDriver({ organizations_tax_id_index: 'organizations' });
    expect((await refusal(run(cls, context(), driver))).table).toBe('organizations');
  });

  // MikroORM 7 (#1866) — `addSql` takes a `raw()` fragment and a native query
  // builder beside a string. Each is judged by what it renders, parameters
  // substituted: a fragment rendered as `[object …]` would name no table.
  it('refuses a raw() fragment by what it renders, its parameters substituted', async () => {
    const plain = migration('Migration20261201T100006AcmeErpRogue', (self) =>
      self.addSql(raw('alter table "organizations" add column "foo" text')),
    );
    expect((await refusal(run(plain))).table).toBe('organizations');
    const named = migration('Migration20261201T100007AcmeErpRogue', (self) =>
      self.addSql(raw('delete from ?? where true', ['organizations'])),
    );
    expect((await refusal(run(named))).table).toBe('organizations');
  });

  it('refuses a native query builder by what it renders', async () => {
    const cls = migration('Migration20261201T100008AcmeErpRogue', (self) =>
      self.addSql(new PostgreSqlPlatform().createNativeQueryBuilder().delete().from('organizations')),
    );
    expect((await refusal(run(cls))).table).toBe('organizations');
  });

  it('refuses a statement of a shape it cannot render, rather than judging its [object …] text', async () => {
    const cls = migration('Migration20261201T100012AcmeErpRogue', (self) =>
      self.addSql({ toQuery: () => 'delete from "organizations"' } as never),
    );
    await expect(run(cls)).rejects.toThrow(/cannot render/);
  });
});

describe('guardExternalMigration — a create does not license DDL on a foreign table (review finding 3)', () => {
  it('refuses `create table if not exists` on a table another module’s entity maps, then a drop', async () => {
    const cls = migration('Migration20261201T100011AcmeErpRogue', (self) => {
      self.addSql('create table if not exists "organizations" ("id" uuid primary key)');
      self.addSql('drop table "organizations"');
    });
    expect((await refusal(run(cls))).table).toBe('organizations');
  });

  it('refuses `create table if not exists` followed by an alter in up()', async () => {
    const cls = migration('Migration20261201T100012AcmeErpRogue', (self) => {
      self.addSql('create table if not exists "organizations" ("id" uuid primary key)');
      self.addSql('alter table "organizations" add column "foo" text');
    });
    expect((await refusal(run(cls))).table).toBe('organizations');
  });

  it('lets the `if not exists` create alone through — the shape of inventory’s bridge migration (D-226)', async () => {
    const cls = migration('Migration20261201T100014AcmeErpBridge', (self) =>
      self.addSql('create table if not exists "organizations" ("id" uuid primary key)'),
    );
    await expect(run(cls)).resolves.toBeDefined();
  });

  it('still lets a migration create a foreign-mapped table that does not exist yet (a pre-split init)', async () => {
    const cls = migration('Migration20261201T100013AcmeErpInit', (self) => {
      self.addSql('create table "organizations" ("id" uuid primary key)');
      self.addSql('create index "organizations_id_index" on "organizations" ("id")');
    });
    await expect(run(cls)).resolves.toBeDefined();
  });
});

describe('guardExternalMigration — exact declared columns (review finding 4)', () => {
  it('refuses a back-fill of an x_ column the module does not declare, even with its prefix', async () => {
    const ctx = context({ moduleId: 'acme', declaredHosts: new Map([['organizations', new Set(['x_acme_tier'])]]) });
    const cls = migration('Migration20261201T100015AcmeBackfill', (self) =>
      self.addSql(`update "organizations" set "x_acme_erp_code" = 'stolen'`),
    );
    expect((await refusal(run(cls, ctx))).table).toBe('organizations');
  });
});

describe('guardExternalMigration — fails closed (D-291 R-A2)', () => {
  it('refuses a table no entity maps and none of the module’s migrations creates', async () => {
    const cls = migration('Migration20261201T100007AcmeErpMystery', (self) =>
      self.addSql('alter table "acme_unseen" add column "x" text'),
    );
    expect((await refusal(run(cls, context({ moduleMigrations: () => [cls] })))).table).toBe('acme_unseen');
  });

  it('refuses when the dry run of an earlier migration throws before it queues the create', async () => {
    const init = migration('Migration20261201T100008AcmeErpInit', () => {
      throw new Error('cannot dry-run');
    });
    const later = migration('Migration20261201T100009AcmeErpLater', (self) =>
      self.addSql('alter table "acme_hidden" add column "x" text'),
    );
    expect((await refusal(run(later, context({ moduleMigrations: () => [init, later] })))).table).toBe('acme_hidden');
  });
});

describe('guardExternalMigration — what it allows', () => {
  it('allows the module’s entity tables, its own new tables, platform tables and the migrations table', async () => {
    const cls = migration('Migration20261201T100010AcmeErpInit', (self) => {
      self.addSql('create table "acme_links" ("id" uuid primary key)');
      self.addSql('create index "acme_links_id_index" on "acme_links" ("id")');
      self.addSql('alter table "acme_rows" add column "note" text');
      self.addSql(`insert into "audit_log_entries" ("id") values ('x')`);
      self.addSql(`delete from "mikro_orm_migrations" where "name" = 'x'`);
    });
    const { instance } = await run(cls);
    expect(instance.getQueries()).toHaveLength(5);
  });

  it('allows the back-fill of its own x_ columns on a declared host', async () => {
    const cls = migration('Migration20261201T090000AcmeErpBackfillCreditTier', (self) =>
      self.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1 where "vat_status" = 'valid'`),
    );
    await expect(run(cls)).resolves.toBeDefined();
  });

  it('allows an exempted first-party write, by module, migration and table', async () => {
    const cls = migration('Migration20260505T102206AcmeErpInit', (self) =>
      self.addSql('alter table "organizations" add column "foo" text'),
    );
    const ctx = context({
      exemptions: [{ moduleId: 'acme_erp', migration: 'Migration20260505T102206AcmeErpInit', table: 'organizations' }],
    });
    await expect(run(cls, ctx)).resolves.toBeDefined();
    const other = context({
      exemptions: [{ moduleId: 'acme_erp', migration: 'Migration20260505T102206AcmeErpOther', table: 'organizations' }],
    });
    await refusal(run(cls, other));
  });

  it('finds a table an earlier migration of the module created, by a dry run', async () => {
    const init = migration('Migration20261201T100020AcmeErpInit', (self) =>
      self.addSql('create table "acme_history" ("id" uuid primary key)'),
    );
    const later = migration('Migration20261201T100021AcmeErpHistoryNote', (self) =>
      self.addSql('alter table "acme_history" add column "note" text'),
    );
    await expect(run(later, context({ moduleMigrations: () => [init, later] }))).resolves.toBeDefined();
  });

  /**
   * `specs/187-side-table-extensions/` research R-15 (T012) — a side table is the
   * module's own table, and a foreign key pointing at a host is not a write on
   * the host. A future guard change that started treating `references` as a
   * foreign write fails this case, named for side tables.
   */
  it('allows a side table whose primary key references a host, with on delete cascade (187 R-15)', async () => {
    const cls = migration('Migration20261201T100030AcmeErpSideTable', (self) => {
      self.addSql(
        'create table "acme_links_x" ("organization_id" uuid not null, "erp_key" text not null, ' +
          'constraint "acme_links_x_pkey" primary key ("organization_id"), ' +
          'constraint "acme_links_x_organization_fk" foreign key ("organization_id") ' +
          'references "organizations" ("id") on delete cascade)',
      );
      self.addSql(
        'alter table "acme_links_x" add constraint "acme_links_x_erp_key_unique" unique ("erp_key")',
      );
    });
    const { instance } = await run(cls);
    expect(instance.getQueries()).toHaveLength(2);
  });

  it('keeps the package’s class name', () => {
    const cls = migration('Migration20261201T100030AcmeErpNamed', () => {});
    expect(guardExternalMigration(cls, context()).name).toBe('Migration20261201T100030AcmeErpNamed');
  });
});

describe('dryRunStatements', () => {
  it('collects what up() queues and executes, without running anything', async () => {
    const driver = fakeDriver();
    const cls = migration('Migration20261201T100040AcmeErpProbe', async (self) => {
      await self.execute('update "orders" set "x" = 1');
      self.addSql('alter table "organizations" add column "y" text');
    });
    const { statements, error } = await dryRunStatements(cls, driver, {});
    expect(error).toBeNull();
    expect(statements).toEqual(['update "orders" set "x" = 1', 'alter table "organizations" add column "y" text']);
    expect(driver.execute).not.toHaveBeenCalled();
  });
});

describe('guardExternalMigration — unattributable dynamic SQL fails closed (review finding 5)', () => {
  it('refuses execute format(…) in a do block', async () => {
    const cls = migration('Migration20261201T100016AcmeErpDynamic', (self) =>
      self.addSql(`do $$ begin execute format('drop table %I', 'organizations'); end $$;`),
    );
    const error = await refusal(run(cls));
    expect(error.table).toBe('(dynamic SQL)');
  });
});

/** Review finding 6 — a dry run must not reach the database by any route. */
describe('dryRunStatements — fails closed on every database handle', () => {
  function spyingDriver() {
    const ran: string[] = [];
    const driver = {
      ...fakeDriver(),
      execute: vi.fn(async (sql: string) => {
        ran.push(sql);
        return [];
      }),
      getConnection: () => ({
        execute: async (sql: string) => {
          ran.push(sql);
          return [];
        },
        getClient: () => ({
          executeQuery: (query: { sql: string }) => {
            ran.push(query.sql);
            return Promise.resolve({ rows: [] });
          },
        }),
      }),
    };
    return { ran, driver };
  }

  it('does not offer this.getKysely() in a dry run', async () => {
    const { ran, driver } = spyingDriver();
    const cls = migration('Migration20261201T100041AcmeErpKysely', async (self) => {
      await (self as unknown as { getKysely(): { executeQuery(q: unknown): Promise<unknown> } })
        .getKysely()
        .executeQuery({ sql: 'delete from "organizations"' });
    });
    const { error } = await dryRunStatements(cls, driver, {});
    expect(ran).toEqual([]);
    expect(String(error)).toMatch(/this\.getKysely\(\)/);
  });

  it('does not run SQL through this.driver', async () => {
    const { ran, driver } = spyingDriver();
    const cls = migration('Migration20261201T100042AcmeErpDriver', async (self) => {
      await (self as unknown as { driver: { execute: (sql: string) => Promise<unknown> } }).driver.execute(
        'delete from "organizations"',
      );
    });
    const { error } = await dryRunStatements(cls, driver, {});
    expect(ran).toEqual([]);
    expect(error).not.toBeNull();
  });

  it('still lets a migration build SQL with raw() and a native builder for addSql', async () => {
    const { driver } = spyingDriver();
    const cls = migration('Migration20261201T100043AcmeErpBuilds', (self) => {
      self.addSql(raw('create table ?? ("id" uuid primary key)', ['acme_built']));
      self.addSql(new PostgreSqlPlatform().createNativeQueryBuilder().delete().from('acme_built'));
    });
    const { statements, error } = await dryRunStatements(cls, driver, {});
    expect(error).toBeNull();
    expect(statements.join('\n')).toMatch(/create table "acme_built"/);
    expect(statements.join('\n')).toMatch(/delete from "acme_built"/);
  });
});

/**
 * Issue #1860 (part of #1073), kept after the MikroORM 7 switch. The guard
 * finds which tables are the module's own and which tables any entity maps by
 * iterating `getMetadata().getAll()`. MikroORM 6 returns a plain object and
 * MikroORM 7 a `Map`, and `Object.values(new Map())` is `[]`. Every case above
 * uses `fakeDriver`'s hand-built object, so none of them can see that. These two
 * read the metadata a real discovery produced, and each fails in a different
 * direction if the iteration yields nothing: an empty "mapped" set lets a
 * `create table if not exists` claim another module's table, and an empty
 * "own" set refuses the module's own entity table.
 */
describe('guardExternalMigration — over a real MetadataStorage (#1860)', () => {
  @Entity({ tableName: 'acme_rows' })
  class RealAcmeRow {
    @PrimaryKey({ type: 'uuid' })
    id!: string;
  }

  @Entity({ tableName: 'organizations' })
  class RealOrganizationLike {
    @PrimaryKey({ type: 'uuid' })
    id!: string;
  }

  const withRealMetadata = async (fn: (driver: ReturnType<typeof fakeDriver>) => Promise<void>): Promise<void> => {
    const orm = await MikroORM.init({
      entities: [RealAcmeRow, RealOrganizationLike],
      dbName: 'x1860_never_connected',
      allowGlobalContext: true,
    });
    try {
      await fn({ ...fakeDriver(), getMetadata: () => orm.getMetadata() } as never);
    } finally {
      await orm.close();
    }
  };
  const realContext = () => context({ entities: [RealAcmeRow], declaredHosts: new Map() });

  it('does not let `create table if not exists` claim a table another entity maps', async () => {
    await withRealMetadata(async (driver) => {
      const cls = migration('Migration20261201T100060AcmeErpClaim', (self) => {
        self.addSql('create table if not exists "organizations" ("id" uuid primary key)');
        self.addSql('alter table "organizations" add column "foo" text');
      });
      expect((await refusal(run(cls, realContext(), driver))).table).toBe('organizations');
    });
  });

  it('lets the module write the table its own entity maps', async () => {
    await withRealMetadata(async (driver) => {
      const cls = migration('Migration20261201T100061AcmeErpOwn', (self) =>
        self.addSql('alter table "acme_rows" add column "note" text'),
      );
      await expect(run(cls, realContext(), driver)).resolves.toBeDefined();
    });
  });
});

/** D-291 R-A6 (T071) — a package may not drop another module's table, in either direction. */
describe('guardExternalMigration — destroying a table another module maps (R-A6)', () => {
  const both = (name: string, up: string[], down: string[]) => {
    const cls = class extends Migration {
      override async up(): Promise<void> {
        for (const sql of up) this.addSql(sql);
      }
      override async down(): Promise<void> {
        for (const sql of down) this.addSql(sql);
      }
    };
    Object.defineProperty(cls, 'name', { value: name });
    return cls as MigrationClass;
  };
  const revert = async (cls: MigrationClass, ctx = context()) => {
    const Guarded = guardExternalMigration(cls, ctx) as unknown as new (d: unknown, c: unknown) => Migration;
    await new Guarded(fakeDriver(), {}).down();
  };

  it('refuses down() dropping a foreign-mapped table its up() created if not exists', async () => {
    const cls = both(
      'Migration20261201T100050AcmeErpBridge',
      ['create table if not exists "organizations" ("id" uuid primary key)'],
      ['drop table if exists "organizations" cascade'],
    );
    const error = await refusal(revert(cls));
    expect(error).toMatchObject({ table: 'organizations', direction: 'down' });
  });

  it('refuses down() dropping a foreign-mapped table its up() created outright', async () => {
    const cls = both(
      'Migration20261201T100051AcmeErpInit',
      ['create table "organizations" ("id" uuid primary key)'],
      ['drop table "organizations"'],
    );
    expect((await refusal(revert(cls))).table).toBe('organizations');
  });

  it.each([
    ['truncate', 'truncate table "organizations"'],
    ['alter … drop', 'alter table "organizations" drop column "name"'],
    ['drop index', 'drop index "organizations_pkey_x"'],
  ])('refuses %s in up() even on a table the same migration created', async (_label, sql) => {
    const cls = migration('Migration20261201T100052AcmeErpInit', (self) => {
      self.addSql('create table "organizations" ("id" uuid primary key)');
      self.addSql('create index "organizations_pkey_x" on "organizations" ("id")');
      self.addSql(sql);
    });
    expect((await refusal(run(cls))).table).toBe('organizations');
  });

  it('lets a derived bridge exemption through, in its own direction only', async () => {
    const cls = both(
      'Migration20261201T100053AcmeErpBridge',
      ['create table if not exists "organizations" ("id" uuid primary key)'],
      ['drop table if exists "organizations" cascade'],
    );
    const bridge = (direction: 'up' | 'down') =>
      context({
        exemptions: [
          { moduleId: 'acme_erp', migration: 'Migration20261201T100053AcmeErpBridge', table: 'organizations', kind: 'bridge', direction },
        ],
      });
    await expect(revert(cls, bridge('down'))).resolves.toBeUndefined();
    await refusal(revert(cls, bridge('up')));
  });

  it('a write exemption does not license destroying the table', async () => {
    const cls = both('Migration20261201T100054AcmeErpInit', ['select 1'], ['drop table "organizations"']);
    const ctx = context({
      exemptions: [{ moduleId: 'acme_erp', migration: 'Migration20261201T100054AcmeErpInit', table: 'organizations' }],
    });
    await refusal(revert(cls, ctx));
  });
});

/** D-291 R-A7 (T072) — a down() destruction the owner cannot outlive is exempt, for every author. */
describe('guardExternalMigration — R-A7 down() exemption', () => {
  const dropping = (name: string) => {
    const cls = class extends Migration {
      override async up(): Promise<void> {}
      override async down(): Promise<void> {
        this.addSql('drop table if exists "organizations" cascade');
      }
    };
    Object.defineProperty(cls, 'name', { value: name });
    return cls as MigrationClass;
  };
  const revert = async (cls: MigrationClass, ctx: ForeignSchemaGuardContext) => {
    const Guarded = guardExternalMigration(cls, ctx) as unknown as new (d: unknown, c: unknown) => Migration;
    await new Guarded(fakeDriver(), {}).down();
  };

  it('exempts it when the owner depends on the writer (dependents-block removes the owner first)', async () => {
    const ctx = context({
      reverseEdges: { ownerOf: (table) => (table === 'organizations' ? 'organizations' : undefined), clause: () => 'owner-depends-on-writer' },
    });
    await expect(revert(dropping('Migration20261201T100055AcmeErpInit'), ctx)).resolves.toBeUndefined();
  });

  it('still refuses it when the predicate does not hold', async () => {
    const ctx = context({
      reverseEdges: { ownerOf: () => 'organizations', clause: () => null },
    });
    expect((await refusal(revert(dropping('Migration20261201T100056AcmeErpInit'), ctx))).direction).toBe('down');
  });

  it('refuses it when the owner cannot be attributed (fail closed)', async () => {
    const ctx = context({ reverseEdges: { ownerOf: () => undefined, clause: () => 'writer-is-core' } });
    await refusal(revert(dropping('Migration20261201T100057AcmeErpInit'), ctx));
  });

  it('honours a rendered derived-down entry, in down() only', async () => {
    const ctx = context({
      exemptions: [
        { moduleId: 'acme_erp', migration: 'Migration20261201T100058AcmeErpInit', table: 'organizations', kind: 'derived-down', direction: 'down', clause: 'both-required' },
      ],
    });
    await expect(revert(dropping('Migration20261201T100058AcmeErpInit'), ctx)).resolves.toBeUndefined();
  });
});

/**
 * Issue #1889 — the raw database handles a guarded migration can reach: its own
 * `getKysely()` and `driver`, the entity manager's driver, the connection's kysely client,
 * `begin()` and the transaction a `transactional(cb)` callback receives, and the
 * migration's own transaction context. Each one either judges what it runs or is
 * refused — none passes a raw handle through. The real-database half is
 * `backend/test/integration/db/foreign-schema-guard.test.ts`.
 */
describe('guardExternalMigration — raw database handles (#1889)', () => {
  /** A driver whose connection records what reaches it, and which transaction it ran on. */
  function handleDriver() {
    const ran: Array<{ readonly sql: string; readonly ctx: unknown }> = [];
    const base = fakeDriver();
    const realTrx = Object.assign(
      (table: string) => {
        ran.push({ sql: `trx(${table})`, ctx: 'raw' });
        return { delete: async () => ran.push({ sql: `delete ${table}`, ctx: 'raw' }) };
      },
      { raw: async (sql: string) => ran.push({ sql, ctx: 'raw' }), isCompleted: () => false },
    );
    const settled: Array<readonly [string, unknown]> = [];
    const connection = {
      client: { raw: async (sql: string) => ran.push({ sql, ctx: 'client' }) },
      getClient: () => connection.client,
      getPlatform: base.getPlatform,
      execute: vi.fn(async (sql: string, _params?: unknown[], _method?: string, ctx?: unknown) => {
        ran.push({ sql, ctx });
        return [];
      }),
      begin: vi.fn(async () => realTrx),
      commit: vi.fn(async (ctx: unknown) => void settled.push(['commit', ctx])),
      rollback: vi.fn(async (ctx: unknown) => void settled.push(['rollback', ctx])),
      transactional: vi.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(realTrx)),
      loadFile: vi.fn(async () => ran.push({ sql: 'loadFile', ctx: 'raw' })),
    };
    const driver = {
      ...base,
      connection,
      execute: vi.fn(async (sql: string, params?: unknown[], _method?: string, ctx?: unknown) => {
        await base.execute(sql, params);
        ran.push({ sql, ctx });
        return [];
      }),
      getConnection: () => connection,
      nativeDelete: vi.fn(async () => ran.push({ sql: 'nativeDelete', ctx: 'raw' })),
    };
    return { ran, settled, driver, connection, realTrx };
  }

  /** The migration as these attempts see it: its handles, untyped by MikroORM. */
  interface Self {
    readonly driver: {
      execute(...args: unknown[]): Promise<unknown>;
      nativeDelete(...args: unknown[]): Promise<unknown>;
      getConnection(): Connection;
    };
    readonly ctx: unknown;
    getKysely(): unknown;
    execute(sql: string, params?: unknown[]): Promise<unknown>;
    addSql(sql: unknown): void;
    setTransactionContext(ctx: unknown): void;
    up(): Promise<void>;
  }
  interface Connection {
    execute(...args: unknown[]): Promise<unknown>;
    getClient(): unknown;
    loadFile(path: string): Promise<unknown>;
    commit(ctx: unknown): Promise<unknown>;
    transactional(cb: (trx: Trx) => Promise<unknown>): Promise<unknown>;
    begin(): Promise<Trx>;
  }
  type Trx = ((table: string) => { delete(): Promise<unknown> }) & { raw(sql: string): Promise<unknown> };

  const attempt = async (up: (self: Self) => Promise<unknown>, setup?: (instance: Self, trx: unknown) => void) => {
    const handles = handleDriver();
    const cls = migration('Migration20261201T100070AcmeErpRawHandle', async (self) => {
      await up(self as unknown as Self);
    });
    const Guarded = guardExternalMigration(cls, context()) as unknown as new (d: unknown, c: unknown) => Self;
    const instance = new Guarded(handles.driver, {});
    setup?.(instance, handles.realTrx);
    const outcome = await instance.up().then(
      () => null,
      (error: unknown) => error,
    );
    return { ...handles, outcome };
  };

  it.each<[string, (self: Self) => Promise<unknown>]>([
    ['this.getKysely()', (self) => (self.getKysely() as unknown as Trx).raw('delete from "organizations"')],
    ['this.driver.execute()', (self) => self.driver.execute('delete from "organizations"')],
    ['this.driver.nativeDelete()', (self) => self.driver.nativeDelete('Organization', {})],
    ['this.driver.connection', async (self) => (self.driver as unknown as { connection: Connection }).connection.execute('select 1')],
    ['this.driver.getConnection().client', async (self) => (self.driver.getConnection() as unknown as { client: Trx }).client.raw('delete from "organizations"')],
    ['this.driver.getConnection().getClient()', async (self) => self.driver.getConnection().getClient()],
    ['this.driver.getConnection().loadFile()', (self) => self.driver.getConnection().loadFile('rogue.sql')],
    ['getConnection().execute()', (self) => self.driver.getConnection().execute('delete from "organizations"')],
    ['getEntityManager-free getDriver chain: driver.getConnection().begin() + trx()', async (self) => (await self.driver.getConnection().begin())('organizations').delete()],
    ['begin() + trx.raw()', async (self) => (await self.driver.getConnection().begin()).raw('delete from "organizations"')],
    ['transactional(trx => trx(table))', (self) => self.driver.getConnection().transactional((trx) => trx('organizations').delete())],
    ['transactional(trx => trx.raw())', (self) => self.driver.getConnection().transactional((trx) => trx.raw('delete from "organizations"'))],
    ['transactional(…) + execute(foreign, …, trx)', (self) => {
      const connection = self.driver.getConnection();
      return connection.transactional((trx) => connection.execute('delete from "organizations"', [], 'run', trx));
    }],
    ['this.ctx', async (self) => (self.ctx as Trx).raw('delete from "organizations"')],
  ])('refuses %s, and nothing reaches the database', async (_label, up) => {
    const { outcome, ran } = await attempt(up, (instance, trx) => instance.setTransactionContext(trx));
    expect(outcome).toBeInstanceOf(ForeignSchemaWriteError);
    expect(ran.filter((entry) => !entry.sql.startsWith('select'))).toEqual([]);
  });

  it('runs an own-table statement on a transaction it handed out as that transaction', async () => {
    const { outcome, ran, realTrx } = await attempt((self) => {
      const connection = self.driver.getConnection();
      return connection.transactional((trx) => connection.execute('insert into "acme_rows" ("id") values (1)', [], 'run', trx));
    });
    expect(outcome).toBeNull();
    expect(ran).toEqual([{ sql: 'insert into "acme_rows" ("id") values (1)', ctx: realTrx }]);
  });

  it('settles a begun transaction on the real one', async () => {
    let handedOut: unknown;
    const { outcome, settled, realTrx } = await attempt(async (self) => {
      const connection = self.driver.getConnection();
      handedOut = await connection.begin();
      await connection.commit(handedOut);
    });
    expect(outcome).toBeNull();
    // Compared by identity: a matcher would probe the sealed handle's members.
    expect(handedOut === realTrx).toBe(false);
    expect(settled).toEqual([['commit', realTrx]]);
  });

  it('runs this.execute() and this.driver.execute() on its own tables, in the migration’s transaction', async () => {
    const { outcome, ran, realTrx } = await attempt(
      async (self) => {
        await self.execute('insert into "acme_rows" ("id") values (1)');
        await self.driver.execute('insert into "acme_rows" ("id") values (2)', [], 'run', self.ctx);
      },
      (instance, trx) => instance.setTransactionContext(trx),
    );
    expect(outcome).toBeNull();
    expect(ran).toEqual([
      { sql: 'insert into "acme_rows" ("id") values (1)', ctx: realTrx },
      { sql: 'insert into "acme_rows" ("id") values (2)', ctx: realTrx },
    ]);
  });

  it('still lets the migration build SQL with raw() for addSql, judged as queued', async () => {
    const own = await attempt(async (self) => {
      self.addSql(raw('create table ?? ("id" uuid primary key)', ['acme_built']));
    });
    expect(own.outcome).toBeNull();
    const foreign = await attempt(async (self) => {
      self.addSql(raw('delete from ??', ['organizations']));
    });
    expect(foreign.outcome).toBeInstanceOf(ForeignSchemaWriteError);
  });

  it('offers nothing through reflection on a sealed handle', async () => {
    const { outcome } = await attempt(
      async (self) => {
        const connection = self.driver.getConnection();
        expect(Object.getOwnPropertyDescriptor(connection, 'client')).toBeUndefined();
        expect(Object.keys(connection)).toEqual([]);
        expect(Object.getOwnPropertyDescriptor(self.driver, 'connection')).toBeUndefined();
        await connection.transactional(async (trx) => {
          expect(Object.getOwnPropertyDescriptor(trx, 'client')).toBeUndefined();
          expect(Object.keys(trx)).toEqual([]);
        });
      },
    );
    expect(outcome).toBeNull();
  });

  it('keeps a probe of this.driver.execute working (paid-modules shape)', async () => {
    const { outcome } = await attempt(async (self) => {
      expect(typeof (self.driver as { execute?: unknown }).execute).toBe('function');
    });
    expect(outcome).toBeNull();
  });
});

describe('dryRunStatements — the driver it offers is sealed (#1889)', () => {
  it('refuses a driver member that is not metadata, and runs nothing', async () => {
    const nativeDelete = vi.fn(async () => []);
    const driver = { ...fakeDriver(), nativeDelete };
    const cls = migration('Migration20261201T100071AcmeErpDryDriver', async (self) => {
      await (self as unknown as { driver: { nativeDelete(): Promise<unknown> } }).driver.nativeDelete();
    });
    const { error } = await dryRunStatements(cls, driver, {});
    expect(error).not.toBeNull();
    expect(nativeDelete).not.toHaveBeenCalled();
  });
});
