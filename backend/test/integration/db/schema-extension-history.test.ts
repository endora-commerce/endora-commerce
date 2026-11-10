import { Migration } from '@mikro-orm/migrations';
import type { MikroORM } from '@mikro-orm/postgresql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import {
  activeSchemaExtensionContext,
  migrateUpVerified,
  schemaExtensionMigrationName,
  verifySchemaExtensions,
} from '@endora-commerce/platform/db';
import { SCHEMA_EXTENSIONS_EXIT, runSchemaExtensionsCommand } from '@endora-commerce/platform/lifecycle';
import type { ColumnExtension } from '@endora-commerce/platform/kernel';

import {
  DECLARING_MODULE,
  declare,
  openFixtureOrm,
  throwawayDatabase,
  type FixtureOptions,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` D-291 R-A4 / R-A5 (tasks.md T068, T069) —
 * what `migrateUpVerified` may do to the migration history and the ledger
 * beyond running migrations.
 *
 * R-A4: it prunes rows of `mikro_orm_migrations` only when the name carries the
 * reserved stamp and is not in the current migration list, inside the `up`
 * transaction, each pruned name logged at `info`.
 * R-A5: it marks `orphaned` the `applied` ledger rows of a module that has no
 * discovered declaration at all — a package removed without `uninstall --hard`
 * — so `drop --confirm` can clean up after it; boot stays read-only.
 */

const declaration = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
  },
});

const STALE = 'Migration10000101T000000AcmeErpSchemaExtensionsdeadbeef0000';
const STALE_OTHER = 'Migration10000101T000000OtherModSchemaExtensions0123456789ab';
const NOT_GENERATED = 'Migration20990101T000000FixtureHostNotInTheList';

let db: ThrowawayDatabase;
const opened: MikroORM[] = [];

beforeEach(async () => {
  db = await throwawayDatabase('x178hist');
});
afterEach(async () => {
  for (const orm of opened.splice(0)) await orm.close(true);
  await db.drop();
});

async function migrate(
  declarations: readonly ColumnExtension[],
  options: FixtureOptions = {},
): Promise<{ orm: MikroORM; info: string[]; error: unknown }> {
  const orm = await openFixtureOrm(db.url, declarations, { platform: true, ...options });
  opened.push(orm);
  const info: string[] = [];
  let error: unknown = null;
  try {
    await migrateUpVerified(orm, activeSchemaExtensionContext(), () => {}, (line) => void info.push(line));
  } catch (caught) {
    error = caught;
  }
  return { orm, info, error };
}

const history = async (): Promise<string[]> =>
  (await db.query<{ name: string }>(`select name from mikro_orm_migrations order by name`)).map((row) => row.name);

const ledger = async (): Promise<Record<string, string>> =>
  Object.fromEntries(
    (
      await db.query<{ module_id: string; physical_name: string; status: string }>(
        `select module_id, physical_name, status from schema_extensions order by physical_name`,
      )
    ).map((row) => [`${row.module_id}:${row.physical_name}`, row.status]),
  );

const insertHistory = (...names: string[]): Promise<unknown> =>
  db.query(
    `insert into mikro_orm_migrations (name, executed_at) select unnest($1::text[]), now()`,
    [names],
  );

describe('T068 — pruning the history of generated steps (R-A4)', () => {
  it('deletes only reserved-stamp names not in the current list, logging each at info', async () => {
    await migrate([declaration]);
    const current = schemaExtensionMigrationName(DECLARING_MODULE, [declaration]);
    await insertHistory(STALE, STALE_OTHER, NOT_GENERATED);

    const { info, error } = await migrate([declaration]);
    expect(error).toBeNull();
    const after = await history();
    expect(after).toContain(current);
    expect(after).toContain(NOT_GENERATED);
    expect(after).not.toContain(STALE);
    expect(after).not.toContain(STALE_OTHER);
    expect(info.filter((line) => line.includes(STALE))).toHaveLength(1);
    expect(info.filter((line) => line.includes(STALE_OTHER))).toHaveLength(1);
    expect(info.some((line) => line.includes(NOT_GENERATED) || line.includes(current))).toBe(false);
  });

  it('prunes a stale generated row even when nothing is declared any more', async () => {
    await migrate([declaration]);
    const current = schemaExtensionMigrationName(DECLARING_MODULE, [declaration]);
    await migrate([]);
    expect(await history()).not.toContain(current);
  });

  it('rolls the pruning back with a failed up', async () => {
    await migrate([declaration]);
    await insertHistory(STALE);
    class Migration20261110T000009FixtureHostFails extends Migration {
      override async up(): Promise<void> {
        this.addSql('select * from "no_such_table_x178"');
      }
    }
    const { error } = await migrate([declaration], { hostMigrations: [Migration20261110T000009FixtureHostFails] });
    expect(error).not.toBeNull();
    expect(await history()).toContain(STALE);
  });
});

describe('T069 — the ledger of a vanished package (R-A5)', () => {
  it('marks the rows of a module with no declaration orphaned at migrate, drop then succeeds', async () => {
    await migrate([declaration]);
    expect(Object.values(await ledger()).every((status) => status === 'applied')).toBe(true);

    const { orm } = await migrate([]);
    const rows = await ledger();
    expect(Object.keys(rows).length).toBeGreaterThan(0);
    expect(Object.values(rows).every((status) => status === 'orphaned')).toBe(true);

    const out: string[] = [];
    const code = await runSchemaExtensionsCommand(['drop', DECLARING_MODULE, '--confirm'], {
      orm: async () => orm,
      declarations: () => [],
      commandBus: async () => new CommandBus(orm as never, new AuditLogService(() => orm.em.fork() as never), new EventBus()),
      out: (line) => void out.push(line),
      err: (line) => void out.push(line),
    });
    expect(code, out.join('')).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    expect(Object.values(await ledger()).every((status) => status === 'dropped')).toBe(true);
  });

  it('re-attaches the rows when the same package returns', async () => {
    await migrate([declaration]);
    await migrate([]);
    await migrate([declaration]);
    expect(Object.values(await ledger()).every((status) => status === 'applied')).toBe(true);
  });

  it('leaves a module that still declares something to its generated step', async () => {
    await migrate([declaration]);
    await db.query(
      `insert into schema_extensions (id, module_id, host_table, kind, physical_name, declared_key, spec, spec_hash,
         status, platform_version, package_version, applied_at)
       values (gen_random_uuid(), 'other_mod', 'x178_hosts', 'column', 'x_other_mod_note', 'note', '{}', 'h',
         'applied', '0', null, now())`,
    );
    await migrate([declaration]);
    const rows = await ledger();
    expect(rows['other_mod:x_other_mod_note']).toBe('orphaned');
    for (const [key, status] of Object.entries(rows)) {
      if (key.startsWith(`${DECLARING_MODULE}:`)) expect(status).toBe('applied');
    }
  });

  it('boot stays read-only: the verifier marks nothing', async () => {
    const { orm } = await migrate([declaration]);
    await verifySchemaExtensions(
      (sql, params = []) => orm.em.getConnection().execute(sql, params, 'all') as Promise<Record<string, unknown>[]>,
      { declarations: [], hosts: new Map(), ownership: null },
      () => {},
    );
    expect(Object.values(await ledger()).every((status) => status === 'applied')).toBe(true);
  });
});
