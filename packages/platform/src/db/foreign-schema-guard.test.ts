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

function fakeDriver(indexes: Record<string, string> = {}) {
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
    declaredHosts: new Map([['organizations', 'x_acme_erp_']]),
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
