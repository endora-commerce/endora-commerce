import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Migration } from '@mikro-orm/migrations';
import type { MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { migrateUpVerified, schemaExtensionMigrationName } from '@endora-commerce/platform/db';
import {
  SCHEMA_EXTENSIONS_EXIT,
  runSchemaExtensionsCommand,
  type SchemaExtensionsRuntime,
} from '@endora-commerce/platform/lifecycle';
import type { ColumnExtension } from '@endora-commerce/platform/kernel';

import {
  DECLARING_MODULE,
  ORG_HOST_TABLE,
  HOST_TABLE,
  declare,
  openFixtureOrm,
  revertMigration,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * `specs/178-extensible-columns/` FR-081 (tasks.md T029) —
 * `module:schema-extensions list` and the audited `drop`.
 */

const declaration = declare({
  columns: {
    erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
    creditTier: { type: 'smallint', default: 0 },
  },
});

let db: ThrowawayDatabase;
let orm: MikroORM;
let declared: readonly ColumnExtension[] = [declaration];

function runtime(): SchemaExtensionsRuntime & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    orm: async () => orm,
    declarations: () => declared,
    commandBus: async () => new CommandBus(orm as never, new AuditLogService(() => orm.em.fork() as never), new EventBus()),
    out: (line) => void stdout.push(line),
    err: (line) => void stderr.push(line),
  };
}

async function ledger(): Promise<Record<string, { status: string; drop_audit_id: string | null }>> {
  const rows = await db.query<{ physical_name: string; status: string; drop_audit_id: string | null }>(
    `select physical_name, status, drop_audit_id from schema_extensions order by physical_name`,
  );
  return Object.fromEntries(rows.map((r) => [r.physical_name, { status: r.status, drop_audit_id: r.drop_audit_id }]));
}

beforeAll(async () => {
  db = await throwawayDatabase();
  orm = await openFixtureOrm(db.url, [declaration], { platform: true });
  await migrateUpVerified(orm);
  await db.query(`insert into x178_hosts (id, name, x_acme_erp_erp_code) values (gen_random_uuid(), 'a', 'E-1'), (gen_random_uuid(), 'b', null)`);
}, 120_000);

afterAll(async () => {
  await orm?.close(true);
  await db?.drop();
});

describe('module:schema-extensions', () => {
  it('list prints the ledger', async () => {
    const rt = runtime();
    expect(await runSchemaExtensionsCommand(['list'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    const text = rt.stdout.join('');
    expect(text).toMatch(/MODULE\s+HOST\s+KIND\s+ELEMENT/);
    expect(text).toContain('x_acme_erp_erp_code');
    expect(text).toContain('ux_x178_hosts_x_acme_erp_erp_code');
    const json = runtime();
    await runSchemaExtensionsCommand(['list', '--module', DECLARING_MODULE, '--json'], json);
    expect(JSON.parse(json.stdout.join('')).elements).toHaveLength(3);
  });

  it('refuses to drop what an installed package still declares', async () => {
    const rt = runtime();
    expect(await runSchemaExtensionsCommand(['drop', DECLARING_MODULE, '--confirm'], rt)).toBe(
      SCHEMA_EXTENSIONS_EXIT.refused,
    );
    expect(rt.stderr.join('')).toContain('extension-still-declared');
    expect(Object.values(await ledger()).every((row) => row.status === 'applied')).toBe(true);
  });

  it('refuses rows that are not orphaned', async () => {
    declared = [];
    const rt = runtime();
    expect(await runSchemaExtensionsCommand(['drop', DECLARING_MODULE], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.refused);
    expect(rt.stderr.join('')).toContain('not-orphaned');
  });

  it('prints the plan without --confirm and changes nothing', async () => {
    // The declaring module was hard-uninstalled: its generated step's down() orphans its rows.
    const name = schemaExtensionMigrationName(DECLARING_MODULE, [declaration]);
    await revertMigration(orm, name);
    const rt = runtime();
    expect(await runSchemaExtensionsCommand(['drop', DECLARING_MODULE], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    const text = rt.stdout.join('');
    expect(text).toContain('drop index if exists "ux_x178_hosts_x_acme_erp_erp_code";');
    expect(text).toContain('alter table "x178_hosts" drop column if exists "x_acme_erp_erp_code";');
    expect(text).toContain('x178_hosts.x_acme_erp_erp_code: 1 row(s) hold a value');
    expect(text).toContain('Nothing was changed');
    expect(Object.values(await ledger()).every((row) => row.status === 'orphaned')).toBe(true);
  });

  it('drops with --confirm: columns gone, rows dropped, one audit entry without values', async () => {
    const rt = runtime();
    expect(await runSchemaExtensionsCommand(['drop', DECLARING_MODULE, '--confirm'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    const columns = await db.query(
      `select column_name from information_schema.columns where table_name = 'x178_hosts' and column_name like 'x\\_%'`,
    );
    expect(columns).toEqual([]);
    const rows = Object.values(await ledger());
    expect(rows.every((row) => row.status === 'dropped')).toBe(true);
    const audits = await db.query<{ id: string; state_before: unknown; state_after: unknown }>(
      `select id, state_before, state_after from audit_log_entries where action = 'schema_extension.drop'`,
    );
    expect(audits).toHaveLength(1);
    expect(rows.every((row) => row.drop_audit_id === audits[0]!.id)).toBe(true);
    const recorded = JSON.stringify(audits[0]);
    expect(recorded).toContain('x178_hosts.x_acme_erp_erp_code');
    expect(recorded).not.toContain('E-1');
  });
});

/**
 * `specs/178-extensible-columns/` FR-073 (tasks.md T067) — the guard's verdict
 * over the installed packages' migrations, **without executing them**, so an
 * operator can check a release's packages before upgrading to the one that
 * refuses.
 */
describe('module:schema-extensions audit-packages', () => {
  class Migration20261201T100000AcmeErpRogue extends Migration {
    override async up(): Promise<void> {
      this.addSql(`alter table "${ORG_HOST_TABLE}" add column "foo" text`);
      this.addSql(`update "${HOST_TABLE}" set "x_acme_erp_credit_tier" = 1`);
    }
  }
  const rogue = {
    id: DECLARING_MODULE,
    packageName: '@acme/mod-acme-erp',
    entities: [],
    migrations: [{ cls: Migration20261201T100000AcmeErpRogue }],
    schemaExtensions: [declaration],
  };

  it('lists every would-be refusal and executes nothing', async () => {
    const rt = { ...runtime(), packages: async () => [rogue] };
    expect(await runSchemaExtensionsCommand(['audit-packages'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.refused);
    const out = rt.stdout.join('');
    expect(out).toContain('@acme/mod-acme-erp');
    expect(out).toContain('Migration20261201T100000AcmeErpRogue');
    expect(out).toContain(ORG_HOST_TABLE);
    // The own-column back-fill on the declared host is not a refusal.
    expect(out).not.toMatch(new RegExp(`→ ${HOST_TABLE}\\b`));
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = $1 and column_name = 'foo'`,
      [ORG_HOST_TABLE],
    );
    expect(columns).toEqual([]);
  });

  it('answers JSON with --json', async () => {
    const rt = { ...runtime(), packages: async () => [rogue] };
    await runSchemaExtensionsCommand(['audit-packages', '--json'], rt);
    const parsed = JSON.parse(rt.stdout.join('')) as { findings: { table: string; migration: string }[] };
    expect(parsed.findings).toEqual([
      expect.objectContaining({ table: ORG_HOST_TABLE, migration: 'Migration20261201T100000AcmeErpRogue' }),
    ]);
  });

  it('exits 0 when no installed package would be refused', async () => {
    const rt = { ...runtime(), packages: async () => [] };
    expect(await runSchemaExtensionsCommand(['audit-packages'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    expect(rt.stdout.join('')).toContain('no installed package migration would be refused');
  });
});
