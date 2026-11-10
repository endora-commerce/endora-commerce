import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  checkExtensibleTables,
  publishedBindings,
  report,
  type ExtensibleBinding,
  type MigrationSourceInput,
} from '../../../scripts/check-extensible-tables.js';

/**
 * `check:extensible-tables` (`specs/178-extensible-columns/` FR-072, FR-012) —
 * the companion test. Every red proof enters at the top of the analysis, as
 * migration **source text**, so the literal walk, the `down()` exclusion and the
 * shape recognisers all run (issue #130); one proof per shape the rule refuses.
 */

const BINDINGS: readonly ExtensibleBinding[] = [
  { entityType: 'organization', table: 'organizations', ownerModuleId: 'organizations' },
  { entityType: 'order', table: 'orders', ownerModuleId: 'orders' },
];

function migrationOf(up: string, down = ''): string {
  return (
    `import { Migration } from '@mikro-orm/migrations';\n` +
    `export class Migration20261201T000000OrganizationsRebuild extends Migration {\n` +
    `  override async up(): Promise<void> {\n${up}\n  }\n` +
    `  override async down(): Promise<void> {\n${down}\n  }\n}\n`
  );
}

function run(sources: Record<string, MigrationSourceInput>, owners: ReadonlyMap<string, string> | null = null) {
  return checkExtensibleTables({ migrations: new Map(Object.entries(sources)), bindings: BINDINGS, owners });
}

const orgs = (up: string, down = ''): Record<string, MigrationSourceInput> => ({
  'packages/modules/organizations/src/migrations/20261201T000000_organizations_rebuild.ts': {
    moduleId: 'organizations',
    text: migrationOf(up, down),
  },
  'packages/modules/orders/src/migrations/20261201T000000_orders_init.ts': {
    moduleId: 'orders',
    text: migrationOf('this.addSql(`create table "orders" ("id" uuid primary key)`);'),
  },
});

const kinds = (result: ReturnType<typeof run>): string[] => result.findings.map((finding) => finding.kind);

describe('extensible-table-rebuild — one red proof per shape', () => {
  it.each([
    ['drop table', 'this.addSql(`drop table if exists "organizations" cascade;`);'],
    ['drop table in a list', 'this.addSql(`drop table "x_tmp", "public"."organizations";`);'],
    ['alter table … rename to', 'this.addSql(`alter table "organizations" rename to "organizations_old";`);'],
    [
      'create table … as select … from',
      'this.addSql(`create table "organizations_new" as select "id", "name" from "organizations";`);',
    ],
    ['insert into … select * from', 'this.addSql(`insert into "organizations_copy" select * from "organizations";`);'],
    ['select * into … from', 'this.addSql(`select * into "organizations_copy" from "organizations";`);'],
    ['a template literal', 'const t = "organizations";\nthis.addSql(`drop table "organizations" -- ${t}`);'],
  ])('%s', (_shape, up) => {
    const result = run(orgs(up));
    expect(kinds(result)).toEqual(['extensible-table-rebuild']);
    expect(result.findings[0]).toMatchObject({ table: 'organizations' });
    expect(result.findings[0]!.location).toMatch(/_organizations_rebuild\.ts:\d+$/);
  });
});

describe('extensible-table-rebuild — what is not a rebuild', () => {
  it('does not judge down(): reverting the creating migration drops the table by definition', () => {
    expect(kinds(run(orgs('', 'this.addSql(`drop table if exists "organizations" cascade;`);')))).toEqual([]);
  });

  it('does not judge a table that is not extensible', () => {
    expect(kinds(run(orgs('this.addSql(`drop table if exists "organization_invitations";`);')))).toEqual([]);
  });

  it('does not judge an in-place change', () => {
    expect(
      kinds(
        run(
          orgs(
            'this.addSql(`alter table "organizations" add column "note" text;`);\n' +
              'this.addSql(`alter table "organizations" drop column "legacy";`);',
          ),
        ),
      ),
    ).toEqual([]);
  });

  it('does not read prose in a comment or a string literal inside the SQL', () => {
    expect(kinds(run(orgs("// drop table organizations\nthis.addSql(`comment on table \"x\" is 'drop table organizations'`);")))).toEqual(
      [],
    );
  });
});

describe('binding-owner-mismatch', () => {
  it('reports a binding whose table another module owns', () => {
    const result = run(orgs(''), new Map([['organizations', 'customer_accounts'], ['orders', 'orders']]));
    expect(kinds(result)).toEqual(['binding-owner-mismatch']);
    expect(result.findings[0]).toMatchObject({ table: 'organizations', location: 'CUSTOM_FIELD_HOST_BINDINGS.organization' });
  });

  it('reports a binding whose table no entity maps', () => {
    expect(kinds(run(orgs(''), new Map([['organizations', 'organizations']])))).toEqual(['binding-owner-mismatch']);
  });

  it('is silent over the published bindings and their owners', () => {
    const bindings = publishedBindings();
    expect(bindings.length).toBeGreaterThan(0);
    const result = checkExtensibleTables({
      migrations: new Map(),
      bindings,
      owners: new Map(bindings.map((binding) => [binding.table, binding.ownerModuleId] as const)),
    });
    expect(result.findings).toEqual([]);
  });
});

describe('the walk', () => {
  it('counts owners covered against owners expected and refuses a short walk with exit 2', () => {
    const short = run({
      'packages/modules/orders/src/migrations/20261201T000000_orders_init.ts': {
        moduleId: 'orders',
        text: migrationOf('this.addSql(`create table "orders" ("id" uuid primary key)`);'),
      },
    });
    expect(short.owners).toEqual({ expected: 2, covered: 1, missing: ['organizations'] });
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => report(short)).toThrow('exit 2');
    } finally {
      exit.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('skips migrations of modules that own no extensible table', () => {
    const result = run({
      ...orgs(''),
      'packages/modules/blog/src/migrations/20261201T000000_blog_init.ts': {
        moduleId: 'blog',
        text: migrationOf('this.addSql(`drop table "organizations";`);'),
      },
    });
    expect(result.files).toBe(2);
    expect(kinds(result)).toEqual([]);
  });
});

describe('the real tree', () => {
  it('runs clean and prints its read line', () => {
    const backend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/check-extensible-tables.ts'], {
      cwd: backend,
      encoding: 'utf8',
    });
    expect(`${result.stdout}${result.stderr}`).toMatch(/\[extensible-tables\] read: files=\d+ sites=\d+ sources=extensible-owners:(\d+)\/\1/);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  }, 300_000);
});
