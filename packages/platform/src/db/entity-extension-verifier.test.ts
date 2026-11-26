import { describe, expect, it } from 'vitest';
import { ENTITY_EXTENSION_HOSTS } from '../kernel/schema-extensions/extensible-hosts.js';
import type { ResolvedEntityExtension } from '../kernel/entity-extensions/declarations.js';
import type { EntityExtensionContext, EntityExtensionTableOwner } from '../kernel/entity-extensions/context.js';
import { EntityExtensionDriftError } from '../kernel/entity-extensions/errors.js';
import {
  ENTITY_EXTENSION_UNDECLARED_POLICY,
  inspectEntityExtensions,
  verifyEntityExtensions,
} from './entity-extension-verifier.js';

/**
 * `specs/187-side-table-extensions/contracts/verification-rules.md` §4 – §5
 * (FR-020 – FR-023, FR-030 – FR-031) — the physical rules over the rows of the
 * one catalog query, with the database stood in for by a function. The same
 * rules against PostgreSQL are `backend/test/integration/db/entity-extension-verifier.test.ts`.
 */

interface Row {
  table_name: string;
  pk_name: string;
  fk_name: string;
  host_table: string;
  on_delete: string;
  references_host_pk: boolean;
}

function row(table: string, host: string, overrides: Partial<Row> = {}): Row {
  return {
    table_name: table,
    pk_name: `${table}_pkey`,
    fk_name: `${table}_fk`,
    host_table: host,
    on_delete: 'c',
    references_host_pk: true,
    ...overrides,
  };
}

function extension(entity: string, table: string, moduleId = 'acme_links'): ResolvedEntityExtension {
  return { moduleId, origin: 'package', declaration: { entity, table }, host: ENTITY_EXTENSION_HOSTS.get(entity)! };
}

const owner = (moduleId: string | null, className: string, origin: EntityExtensionTableOwner['origin'] = 'package') => ({
  moduleId,
  origin: moduleId === null ? null : origin,
  className,
});

function fakeDatabase(rows: readonly Row[], existing: readonly string[] = []) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const exec = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
    statements.push({ sql, params });
    if (sql.includes('pg_constraint')) return rows as unknown as Record<string, unknown>[];
    if (sql.includes('to_regclass')) return [{ present: existing.includes(String(params[0])) ? params[0] : null }];
    throw new Error(`unexpected statement: ${sql}`);
  };
  return { exec, statements };
}

const declared = extension('organizations.Organization', 'acme_links_organization_refs');
const context = (
  extensions: readonly ResolvedEntityExtension[],
  tables: ReadonlyArray<readonly [string, EntityExtensionTableOwner]> = [],
): EntityExtensionContext => ({ extensions, tables: new Map(tables) });

describe('the policy constant (OR-8)', () => {
  it("is 'warn' in the release that ships the declaration — flipping it is its own reviewed change", () => {
    expect(ENTITY_EXTENSION_UNDECLARED_POLICY).toBe('warn');
  });
});

describe('inspectEntityExtensions — the success path is one statement (FR-023)', () => {
  it('issues exactly one catalog query over the nine host tables, and nothing else, with nothing declared', async () => {
    const db = fakeDatabase([]);
    const report = await inspectEntityExtensions(db.exec, context([]));
    expect(report.queries).toBe(1);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]!.params.slice().sort()).toEqual(
      [...ENTITY_EXTENSION_HOSTS.values()].map((host) => host.table).sort(),
    );
    expect(report.findings).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.rows).toEqual([]);
  });

  it('verifies a declared table in the same one statement, and lists it', async () => {
    const db = fakeDatabase([row('acme_links_organization_refs', 'organizations')]);
    const report = await inspectEntityExtensions(
      db.exec,
      context([declared], [['acme_links_organization_refs', owner('acme_links', 'AcmeLinksOrganizationRef')]]),
    );
    expect(db.statements).toHaveLength(1);
    expect(report.findings).toEqual([]);
    expect(report.rows).toEqual([
      {
        kind: 'entity-extension',
        moduleId: 'acme_links',
        origin: 'package',
        host: 'organizations.Organization',
        hostTable: 'organizations',
        table: 'acme_links_organization_refs',
        constraint: 'acme_links_organization_refs_fk',
        status: 'verified',
      },
    ]);
  });
});

describe('P1 – P4 — a declared table the database does not carry as declared', () => {
  it('P1 table-missing, disambiguated by to_regclass on the failure path only', async () => {
    const db = fakeDatabase([]);
    const report = await inspectEntityExtensions(db.exec, context([declared]));
    expect(report.findings).toEqual([
      expect.objectContaining({ rule: 'table-missing', moduleId: 'acme_links', table: 'acme_links_organization_refs' }),
    ]);
    expect(report.findings[0]!.detail).toContain('migrate up');
    expect(report.queries).toBe(2);
  });

  it('P2 foreign-key-missing when the table exists with no foreign key equal to its primary key', async () => {
    const db = fakeDatabase([], ['acme_links_organization_refs']);
    const report = await inspectEntityExtensions(db.exec, context([declared]));
    expect(report.findings.map((finding) => finding.rule)).toEqual(['foreign-key-missing']);
    expect(report.rows[0]?.status).toBe('violation:foreign-key-missing');
  });

  it('P3 foreign-key-missing when the key references another host, saying which', async () => {
    const db = fakeDatabase([row('acme_links_organization_refs', 'orders')]);
    const [finding] = (await inspectEntityExtensions(db.exec, context([declared]))).findings;
    expect(finding?.rule).toBe('foreign-key-missing');
    expect(finding?.detail).toContain('"orders"');
    expect(finding?.detail).toContain('"organizations"');
  });

  it('P3 foreign-key-missing when the key references a column other than the host primary key', async () => {
    const db = fakeDatabase([row('acme_links_organization_refs', 'organizations', { references_host_pk: false })]);
    const [finding] = (await inspectEntityExtensions(db.exec, context([declared]))).findings;
    expect(finding?.rule).toBe('foreign-key-missing');
    expect(finding?.detail).toContain('not its primary key');
  });

  it('P4 foreign-key-not-cascade, naming the delete action', async () => {
    const db = fakeDatabase([row('acme_links_organization_refs', 'organizations', { on_delete: 'r' })]);
    const [finding] = (await inspectEntityExtensions(db.exec, context([declared]))).findings;
    expect(finding?.rule).toBe('foreign-key-not-cascade');
    expect(finding?.detail).toContain('on delete restrict');
    expect(finding?.detail).toContain('on delete cascade');
  });

  it('reports every finding of a run together, and throws them as one EntityExtensionDriftError', async () => {
    const orderNotes = extension('orders.Order', 'acme_links_order_notes');
    const db = fakeDatabase([row('acme_links_order_notes', 'orders', { on_delete: 'a' })]);
    const error = await verifyEntityExtensions(db.exec, context([declared, orderNotes]), () => {}).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(EntityExtensionDriftError);
    expect((error as EntityExtensionDriftError).findings.map((finding) => finding.rule).sort()).toEqual([
      'foreign-key-not-cascade',
      'table-missing',
    ]);
  });
});

describe('U1 / U2 — a side table nobody declared (FR-030, FR-031)', () => {
  const undeclared = row('legacy_order_flags', 'orders');

  it('U1 under warn: one warn line naming the module, the table and the entry to add — not a refusal', async () => {
    const db = fakeDatabase([undeclared]);
    const lines: string[] = [];
    const report = await verifyEntityExtensions(
      db.exec,
      context([], [['legacy_order_flags', owner('legacy_flags', 'LegacyOrderFlag', 'overlay')]]),
      (line) => lines.push(line),
      { policy: 'warn' },
    );
    expect(report.findings).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('undeclared-entity-extension');
    expect(lines[0]).toContain('module "legacy_flags" (overlay)');
    expect(lines[0]).toContain('"legacy_order_flags"');
    expect(lines[0]).toContain("extends: [{ entity: 'orders.Order', table: 'legacy_order_flags' }]");
    expect(report.rows).toEqual([expect.objectContaining({ moduleId: 'legacy_flags', status: 'undeclared' })]);
  });

  it('U1 under refuse: a refusal', async () => {
    const db = fakeDatabase([undeclared]);
    await expect(
      verifyEntityExtensions(
        db.exec,
        context([], [['legacy_order_flags', owner('legacy_flags', 'LegacyOrderFlag')]]),
        () => {},
        { policy: 'refuse' },
      ),
    ).rejects.toMatchObject({
      name: 'EntityExtensionDriftError',
      findings: [expect.objectContaining({ rule: 'undeclared-entity-extension', moduleId: 'legacy_flags' })],
    });
  });

  it.each(['warn', 'refuse'] as const)('U2 under %s: a table no composed module maps is a warning only', async (policy) => {
    const db = fakeDatabase([undeclared]);
    const lines: string[] = [];
    const report = await verifyEntityExtensions(db.exec, context([]), (line) => lines.push(line), { policy });
    expect(report.findings).toEqual([]);
    expect(lines).toEqual([expect.stringContaining('unowned-entity-extension')]);
    expect(report.rows).toEqual([expect.objectContaining({ moduleId: null, origin: null, status: 'unowned' })]);
  });

  it("never reports a 1:1 table the host's own module keeps (ordinary ownership, E4)", async () => {
    const db = fakeDatabase([row('order_totals', 'orders')]);
    const lines: string[] = [];
    const report = await verifyEntityExtensions(
      db.exec,
      context([], [['order_totals', owner('orders', 'OrderTotal', 'core')]]),
      (line) => lines.push(line),
      { policy: 'refuse' },
    );
    expect(lines).toEqual([]);
    expect(report.rows).toEqual([]);
  });

  it('treats a run with no discovered table facts as unowned — it can warn, never refuse', async () => {
    const db = fakeDatabase([undeclared]);
    const report = await verifyEntityExtensions(db.exec, { extensions: [], tables: null }, () => {}, {
      policy: 'refuse',
    });
    expect(report.findings).toEqual([]);
    expect(report.rows[0]?.status).toBe('unowned');
  });
});
