import { describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { ENTITY_EXTENSION_HOSTS } from '../../kernel/schema-extensions/extensible-hosts.js';
import type { EntityExtensionContext } from '../../kernel/entity-extensions/context.js';
import type { ResolvedEntityExtension } from '../../kernel/entity-extensions/declarations.js';
import type { AuditedPackage } from '../../db/foreign-schema-guard.js';
import { runSchemaExtensionsCommand, SCHEMA_EXTENSIONS_EXIT, type SchemaExtensionsRuntime } from './schema-extensions.js';

/**
 * `specs/187-side-table-extensions/contracts/schema-extensions-cli.md`
 * (FR-040 – FR-042; tasks.md T019, T031) — `module:schema-extensions` gains
 * `entity-extension` rows, derived on each run and never written to the
 * `schema_extensions` ledger. The database is a function; the integration half
 * is `backend/test/integration/_lifecycle/schema-extensions-cli.test.ts`.
 */

interface CatalogRow {
  table_name: string;
  pk_name: string;
  fk_name: string;
  host_table: string;
  on_delete: string;
  references_host_pk: boolean;
}

const ledgerRow = {
  id: 'l-1',
  module_id: 'acme_erp',
  host_table: 'organizations',
  kind: 'column',
  physical_name: 'x_acme_erp_note',
  declared_key: 'note',
  status: 'applied',
  applied_at: '2026-11-01T00:00:00.000Z',
  orphaned_at: null,
};

function extension(entity: string, table: string, moduleId: string, origin: 'core' | 'package' = 'package'): ResolvedEntityExtension {
  return { moduleId, origin, declaration: { entity, table }, host: ENTITY_EXTENSION_HOSTS.get(entity)! };
}

const qrOrg = extension('organizations.Organization', 'quote_request_org_policies', 'quote_requests', 'core');
const acme = extension('organizations.Organization', 'acme_links_organization_refs', 'acme_links');
const catalog: CatalogRow[] = [
  {
    table_name: 'quote_request_org_policies',
    pk_name: 'quote_request_org_policies_pkey',
    fk_name: 'quote_request_org_policies_organization_fk',
    host_table: 'organizations',
    on_delete: 'c',
    references_host_pk: true,
  },
  {
    table_name: 'acme_links_organization_refs',
    pk_name: 'acme_links_organization_refs_pkey',
    fk_name: 'acme_links_organization_refs_org_fk',
    host_table: 'organizations',
    on_delete: 'r',
    references_host_pk: true,
  },
  {
    table_name: 'legacy_order_flags',
    pk_name: 'legacy_order_flags_pkey',
    fk_name: 'legacy_order_flags_order_fk',
    host_table: 'orders',
    on_delete: 'c',
    references_host_pk: true,
  },
];

function runtime(options: {
  ledger?: readonly Record<string, unknown>[];
  context?: EntityExtensionContext;
  packages?: readonly AuditedPackage[];
  dependencies?: ReadonlyMap<string, readonly string[]>;
}) {
  const statements: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const execute = async (sql: string): Promise<unknown[]> => {
    statements.push(sql);
    if (sql.includes('from schema_extensions')) return [...(options.ledger ?? [])];
    if (sql.includes('pg_constraint')) return catalog;
    if (sql.includes('to_regclass')) return [{ present: null }];
    throw new Error(`unexpected statement ${sql}`);
  };
  const orm = {
    em: {
      getConnection: () => ({ execute }),
      getDriver: () => ({ getMetadata: () => ({ getAll: () => new Map() }), getPlatform: () => ({}) }),
    },
    config: {},
  } as unknown as MikroORM;
  const rt: SchemaExtensionsRuntime = {
    orm: async () => orm,
    declarations: () => [],
    commandBus: async () => {
      throw new Error('no command bus in this test');
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    entityExtensions: () =>
      options.context ?? {
        extensions: [qrOrg, acme],
        tables: new Map([
          ['quote_request_org_policies', { moduleId: 'quote_requests', origin: 'core', className: 'QuoteRequestOrgPolicy' }],
          ['acme_links_organization_refs', { moduleId: 'acme_links', origin: 'package', className: 'AcmeLinksOrganizationRef' }],
        ]),
      },
    ...(options.packages === undefined ? {} : { packages: async () => options.packages! }),
    ...(options.dependencies === undefined ? {} : { moduleDependencies: () => options.dependencies! }),
  };
  return { rt, statements, out: () => out.join(''), err: () => err.join('') };
}

describe('list — entity-extension rows (§1, FR-040, FR-042)', () => {
  it('prints a second section after the ledger rows, one row per declared or found side table', async () => {
    const { rt, out } = runtime({ ledger: [ledgerRow] });
    expect(await runSchemaExtensionsCommand(['list'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    const text = out();
    expect(text.indexOf('x_acme_erp_note')).toBeLessThan(text.indexOf('Entity extensions (side tables)'));
    const section = text.slice(text.indexOf('Entity extensions (side tables)'));
    expect(section).toMatch(/MODULE\s+ORIGIN\s+HOST\s+TABLE\s+CONSTRAINT\s+STATUS/);
    expect(section).toMatch(
      /quote_requests\s+core\s+organizations\.Organization\s+quote_request_org_policies\s+quote_request_org_policies_organization_fk\s+verified/,
    );
    // `list` reports a violation; it never fails on one.
    expect(section).toMatch(/acme_links\s+package\s+organizations\.Organization\s+acme_links_organization_refs\s+\S+\s+violation:foreign-key-not-cascade/);
    expect(section).toMatch(/-\s+-\s+orders\.Order\s+legacy_order_flags\s+legacy_order_flags_order_fk\s+unowned/);
  });

  it('orders rows by host, then table', async () => {
    const { rt, out } = runtime({});
    await runSchemaExtensionsCommand(['list'], rt);
    const section = out().slice(out().indexOf('Entity extensions'));
    // `orders.Order` sorts before `organizations.Organization`.
    expect(section.indexOf('legacy_order_flags')).toBeLessThan(section.indexOf('acme_links_organization_refs'));
    expect(section.indexOf('acme_links_organization_refs')).toBeLessThan(section.indexOf('quote_request_org_policies'));
  });

  it('--json adds entityExtensions beside elements', async () => {
    const { rt, out } = runtime({ ledger: [ledgerRow] });
    await runSchemaExtensionsCommand(['list', '--json'], rt);
    const parsed = JSON.parse(out()) as { elements: unknown[]; entityExtensions: unknown[] };
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.entityExtensions).toEqual([
      expect.objectContaining({ moduleId: null, origin: null, table: 'legacy_order_flags', status: 'unowned' }),
      {
        kind: 'entity-extension',
        moduleId: 'acme_links',
        origin: 'package',
        host: 'organizations.Organization',
        hostTable: 'organizations',
        table: 'acme_links_organization_refs',
        constraint: 'acme_links_organization_refs_org_fk',
        status: 'violation:foreign-key-not-cascade',
      },
      expect.objectContaining({ moduleId: 'quote_requests', status: 'verified' }),
    ]);
  });

  it('marks an undeclared table a composed module maps as undeclared, naming the module (T031)', async () => {
    const { rt, out } = runtime({
      context: {
        extensions: [],
        tables: new Map([['legacy_order_flags', { moduleId: 'legacy_flags', origin: 'overlay', className: 'LegacyOrderFlag' }]]),
      },
    });
    await runSchemaExtensionsCommand(['list', '--json'], rt);
    const rows = (JSON.parse(out()) as { entityExtensions: { table: string; moduleId: string | null; status: string }[] })
      .entityExtensions;
    expect(rows.find((row) => row.table === 'legacy_order_flags')).toMatchObject({
      moduleId: 'legacy_flags',
      status: 'undeclared',
    });
    expect(rows.find((row) => row.table === 'quote_request_org_policies')).toMatchObject({
      moduleId: null,
      status: 'unowned',
    });
  });

  it('--module filters both sections', async () => {
    const { rt, out } = runtime({ ledger: [] });
    await runSchemaExtensionsCommand(['list', '--module', 'quote_requests', '--json'], rt);
    const parsed = JSON.parse(out()) as { entityExtensions: { moduleId: string }[] };
    expect(parsed.entityExtensions.map((row) => row.moduleId)).toEqual(['quote_requests']);
  });

  it('writes nothing to the ledger, and issues the catalog query once', async () => {
    const { rt, statements } = runtime({ ledger: [ledgerRow] });
    await runSchemaExtensionsCommand(['list'], rt);
    expect(statements.filter((sql) => /^\s*(insert|update|delete)\b/i.test(sql))).toEqual([]);
    expect(statements.filter((sql) => sql.includes('pg_constraint'))).toHaveLength(1);
  });

  it('prints exactly what it printed before when nothing is declared and no side table exists (inert)', async () => {
    const empty = runtime({
      ledger: [],
      context: { extensions: [], tables: new Map() },
    });
    // The fake catalog always returns rows; an empty one is the inert case.
    catalog.splice(0, catalog.length, ...[]);
    try {
      await runSchemaExtensionsCommand(['list'], empty.rt);
      expect(empty.out()).toBe('(no schema extensions recorded)\n');
    } finally {
      catalog.push(
        { table_name: 'quote_request_org_policies', pk_name: 'quote_request_org_policies_pkey', fk_name: 'quote_request_org_policies_organization_fk', host_table: 'organizations', on_delete: 'c', references_host_pk: true },
        { table_name: 'acme_links_organization_refs', pk_name: 'acme_links_organization_refs_pkey', fk_name: 'acme_links_organization_refs_org_fk', host_table: 'organizations', on_delete: 'r', references_host_pk: true },
        { table_name: 'legacy_order_flags', pk_name: 'legacy_order_flags_pkey', fk_name: 'legacy_order_flags_order_fk', host_table: 'orders', on_delete: 'c', references_host_pk: true },
      );
    }
  });
});

describe('audit-packages — one verdict per extends entry, without a database (§2, FR-041)', () => {
  const pkg = (entityExtensions: readonly unknown[], dependencies: readonly string[]): AuditedPackage => ({
    id: 'acme_links',
    packageName: '@acme/mod-acme-links',
    entities: [],
    migrations: [],
    dependencies,
    entityExtensions,
  });

  it('prints ok for a correct entry and exits 0', async () => {
    const { rt, out, statements } = runtime({
      packages: [pkg([{ entity: 'organizations.Organization', table: 'acme_links_organization_refs' }], ['organizations'])],
      dependencies: new Map([['organizations', []]]),
    });
    expect(await runSchemaExtensionsCommand(['audit-packages'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
    expect(out()).toContain(
      '@acme/mod-acme-links (acme_links) extends organizations.Organization → acme_links_organization_refs: ok',
    );
    expect(statements).toEqual([]);
  });

  it('prints the rule of a refused entry and exits 65', async () => {
    const { rt, out } = runtime({
      packages: [
        pkg(
          [
            { entity: 'organizations.Organization', table: 'acme_links_organization_refs' },
            { entity: 'invoices.Invoice', table: 'acme_links_invoice_refs' },
          ],
          [],
        ),
      ],
    });
    expect(await runSchemaExtensionsCommand(['audit-packages'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.refused);
    expect(out()).toContain('→ acme_links_organization_refs: host-not-a-dependency');
    expect(out()).toContain('→ acme_links_invoice_refs: host-not-extensible');
  });

  it('reads a host owner reached through the committed graph as a dependency', async () => {
    const { rt } = runtime({
      packages: [pkg([{ entity: 'organizations.Organization', table: 'acme_links_organization_refs' }], ['orders'])],
      dependencies: new Map([
        ['orders', ['organizations']],
        ['organizations', []],
      ]),
    });
    expect(await runSchemaExtensionsCommand(['audit-packages'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.ok);
  });

  it('--json carries the verdicts under entityExtensions', async () => {
    const { rt, out } = runtime({
      packages: [pkg([{ entity: 'invoices.Invoice', table: 'acme_links_invoice_refs' }], ['organizations'])],
    });
    await runSchemaExtensionsCommand(['audit-packages', '--json'], rt);
    expect((JSON.parse(out()) as { entityExtensions: unknown[] }).entityExtensions).toEqual([
      {
        packageName: '@acme/mod-acme-links',
        moduleId: 'acme_links',
        entity: 'invoices.Invoice',
        table: 'acme_links_invoice_refs',
        verdict: 'host-not-extensible',
      },
    ]);
  });
});

describe('drop — not applicable to side tables (§3)', () => {
  it('names the uninstall as the way a side-table-only module’s tables go', async () => {
    const { rt, err } = runtime({ ledger: [] });
    expect(await runSchemaExtensionsCommand(['drop', 'acme_links'], rt)).toBe(SCHEMA_EXTENSIONS_EXIT.refused);
    expect(err()).toContain(
      'acme_links has no orphaned schema-extension elements; side tables are dropped by uninstalling the module',
    );
  });

  it('keeps its old refusal for a module with neither', async () => {
    const { rt, err } = runtime({ ledger: [] });
    await runSchemaExtensionsCommand(['drop', 'nobody'], rt);
    expect(err()).toContain('nothing to drop');
  });
});
