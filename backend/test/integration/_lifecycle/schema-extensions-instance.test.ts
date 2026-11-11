import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { migrateUpVerified, schemaExtensionMigrationName } from '@endora-commerce/platform/db';
import {
  SCHEMA_EXTENSIONS_EXIT,
  runInstanceSchemaExtensionsCommand,
} from '@endora-commerce/platform/lifecycle';
import type { ColumnExtension } from '@endora-commerce/platform/kernel';

import { installAcmeErp, rewrite } from '../../helpers/acme-erp-instance.js';
import {
  DECLARING_MODULE,
  HOST_TABLE,
  declare,
  fixtureConfig,
  openFixtureOrm,
  revertMigration,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * Issue #1036 — `module:schema-extensions` run the way an instance runs it.
 *
 * The scaffold renders `backend/src/module-commands/schema-extensions.ts` as one
 * call, `runInstanceSchemaExtensionsCommand({ ormConfig: config })`, over the
 * instance's own `mikro-orm.config.js`. So this file drives exactly that entry
 * point, with an ORM configuration built through the platform's real path
 * (`mikroOrmConfigFrom`, which is what records the "still declared" set) and,
 * for `audit-packages`, a package installed into an instance root's
 * `node_modules` and found the way an instance finds it — by discovery, not by
 * being handed to the command. `checkout` form: `schema-extensions-cli.test.ts`.
 */

const declaration = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
  },
});

let db: ThrowawayDatabase;
let orm: MikroORM;

interface Run {
  readonly code: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

/** One invocation of the instance entry point; `process.exit` is captured, not taken. */
async function instance(
  argv: readonly string[],
  declarations: readonly ColumnExtension[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let code: number | undefined;
  const exit = vi.spyOn(process, 'exit').mockImplementation((value) => {
    code = Number(value);
    return undefined as never;
  });
  try {
    await runInstanceSchemaExtensionsCommand({
      ormConfig: async () => fixtureConfig(db.url, declarations, { platform: true }),
      env,
      argv,
      out: (line) => void stdout.push(line),
      err: (line) => void stderr.push(line),
    });
  } finally {
    exit.mockRestore();
  }
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

async function extensionColumns(): Promise<string[]> {
  const rows = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = $1 order by column_name`,
    [HOST_TABLE],
  );
  return rows.map((row) => row.column_name);
}

async function ledger(): Promise<Record<string, string>> {
  const rows = await db.query<{ physical_name: string; status: string }>(
    `select physical_name, status from schema_extensions order by physical_name`,
  );
  return Object.fromEntries(rows.map((row) => [row.physical_name, row.status]));
}

beforeAll(async () => {
  db = await throwawayDatabase();
  orm = await openFixtureOrm(db.url, [declaration], { platform: true });
  await migrateUpVerified(orm);
  await db.query(
    `insert into ${HOST_TABLE} (id, name, x_acme_erp_erp_code) values (gen_random_uuid(), 'a', 'E-1'), (gen_random_uuid(), 'b', null)`,
  );
}, 120_000);

afterAll(async () => {
  await orm?.close(true);
  await db?.drop();
});

describe('module:schema-extensions from an instance', () => {
  it('list reads the ledger through the instance ORM configuration', async () => {
    const run = await instance(['list', '--json'], [declaration]);
    expect(run.code).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    const elements = (JSON.parse(run.stdout) as { elements: { physical_name: string }[] }).elements;
    expect(elements.map((element) => element.physical_name)).toContain('x_acme_erp_erp_code');
  });

  it('drop refuses an element the instance still declares, and changes nothing', async () => {
    const run = await instance(['drop', DECLARING_MODULE, '--confirm'], [declaration]);
    expect(run.code).toBe(SCHEMA_EXTENSIONS_EXIT.refused);
    expect(run.stderr).toContain('extension-still-declared');
    expect(await extensionColumns()).toEqual(
      expect.arrayContaining(['x_acme_erp_credit_tier', 'x_acme_erp_erp_code']),
    );
    const audits = await db.query(`select 1 from audit_log_entries where action = 'schema_extension.drop'`);
    expect(audits).toEqual([]);
  });

  it('drop --confirm audits and removes only the orphaned elements it was pointed at', async () => {
    // The package was uninstalled: its generated step's down() orphans the rows,
    // and the instance's configuration no longer declares them.
    await revertMigration(orm, schemaExtensionMigrationName(DECLARING_MODULE, [declaration]));
    expect(Object.values(await ledger()).every((status) => status === 'orphaned')).toBe(true);

    const run = await instance(['drop', DECLARING_MODULE, '--key', 'erpCode', '--confirm'], []);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(SCHEMA_EXTENSIONS_EXIT.ok);

    // The host's own columns and the other orphaned extension column survive.
    expect(await extensionColumns()).toEqual(['id', 'name', 'x_acme_erp_credit_tier']);
    const rows = await ledger();
    expect(rows['x_acme_erp_erp_code']).toBe('dropped');
    expect(rows['x_acme_erp_credit_tier']).toBe('orphaned');

    const audits = await db.query<{ id: string; actor_type: string | null; state_after: unknown }>(
      `select * from audit_log_entries where action = 'schema_extension.drop'`,
    );
    expect(audits).toHaveLength(1);
    const recorded = JSON.stringify(audits[0]);
    expect(recorded).toContain(`${HOST_TABLE}.x_acme_erp_erp_code`);
    expect(recorded).not.toContain('x_acme_erp_credit_tier');
    // Names and counts, never the values (audit-state D-288).
    expect(recorded).not.toContain('E-1');
    const linked = await db.query<{ drop_audit_id: string | null }>(
      `select drop_audit_id from schema_extensions where physical_name = 'x_acme_erp_erp_code'`,
    );
    expect(linked[0]?.drop_audit_id).toBe(audits[0]!.id);
  });
});

describe('module:schema-extensions audit-packages from an instance', () => {
  it('reports an installed package that writes a foreign table, without executing it', async () => {
    const installed = installAcmeErp((packageRoot) =>
      rewrite(packageRoot, 'lib/migrations/20261201T090000_acme_erp_backfill_credit_tier.js', (source) =>
        source.replace(
          'async up() {',
          'async up() {\n    this.addSql(`alter table "orders" add column "x1036_foo" text`);',
        ),
      ),
    );
    try {
      const run = await instance(['audit-packages'], [], {
        ...process.env,
        ENDORA_INSTANCE_ROOT: installed.root,
      });
      expect(run.code).toBe(SCHEMA_EXTENSIONS_EXIT.refused);
      expect(run.stdout).toContain('@acme/mod-acme-erp (acme_erp)');
      expect(run.stdout).toContain('Migration20261201T090000AcmeErpBackfillCreditTier');
      expect(run.stdout).toContain('→ orders');
      // Its own back-fill on the host it declares is not a refusal.
      expect(run.stdout).not.toContain('→ organizations');
      const columns = await db.query(
        `select 1 from information_schema.columns where column_name = 'x1036_foo'`,
      );
      expect(columns).toEqual([]);
      const applied = await db.query(
        `select 1 from mikro_orm_migrations where name like '%AcmeErpBackfillCreditTier%'`,
      );
      expect(applied).toEqual([]);
    } finally {
      installed.remove();
    }
  });
});
