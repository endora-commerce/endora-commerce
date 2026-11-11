import { Migration } from '@mikro-orm/migrations';
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
  return {
    executed,
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

  it('refuses a knex builder by what it renders', async () => {
    const cls = migration('Migration20261201T100006AcmeErpRogue', (self) =>
      self.addSql({ toQuery: () => 'alter table "organizations" add column "foo" text' } as never),
    );
    expect((await refusal(run(cls))).table).toBe('organizations');
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
        getKnex: () => ({
          raw: (sql: string) => {
            ran.push(sql);
            return Promise.resolve([]);
          },
        }),
      }),
    };
    return { ran, driver };
  }

  it('does not run SQL through this.getKnex()', async () => {
    const { ran, driver } = spyingDriver();
    const cls = migration('Migration20261201T100041AcmeErpKnex', async (self) => {
      await (self.getKnex() as unknown as { raw: (sql: string) => Promise<unknown> }).raw('delete from "organizations"');
    });
    const { error } = await dryRunStatements(cls, driver, {});
    expect(ran).toEqual([]);
    expect(error).not.toBeNull();
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

  it('still lets a migration build SQL with knex for addSql', async () => {
    const { driver } = spyingDriver();
    const cls = migration('Migration20261201T100043AcmeErpBuilds', (self) => {
      const knex = self.getKnex() as unknown as { schema: { createTable: (t: string, f: (b: { uuid: (c: string) => void }) => void) => unknown } };
      self.addSql(knex.schema.createTable('acme_built', (table) => table.uuid('id')) as never);
    });
    const { statements, error } = await dryRunStatements(cls, driver, {});
    expect(error).toBeNull();
    expect(statements.join('\n')).toMatch(/create table "acme_built"/);
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
