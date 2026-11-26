import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ENTITY_EXTENSION_HOSTS,
  EntityExtensionDriftError,
  activeEntityExtensionContext,
  inspectEntityExtensions,
  migrateUpVerified,
  verifyEntityExtensions,
  type EntityExtensionContext,
  type ResolvedEntityExtension,
  type SchemaExtensionExec,
} from '@endora-commerce/platform/db';

import { openAcmeLinksInstance, type AcmeLinksInstance } from '../../helpers/acme-links-instance.js';

/**
 * `specs/187-side-table-extensions/` US1 – US3 against PostgreSQL (tasks.md
 * T017, T026, T029; `contracts/verification-rules.md` §4 – §6).
 *
 * The fixture `mod-acme-links` is installed into a throwaway instance root over
 * a clone of the migrated template, so the backend's own ORM configuration
 * discovers it as an instance's would; its migration is the run's one pending
 * entry. Every refusal at `migrate` is asserted to roll the whole run back — the
 * fixture's migration unrecorded and its tables absent — which is what "the
 * verifier ran inside the transaction, after the run's migrations" means. The
 * boot half is the read-only call `composeApp` makes, on a plain connection,
 * against a database altered by hand.
 */

const INIT = 'Migration20261201T100000AcmeLinksInit';
const ORG_REFS = 'acme_links_organization_refs';
const ORDER_NOTES = 'acme_links_order_notes';

let instance: AcmeLinksInstance;

beforeAll(async () => {
  instance = await openAcmeLinksInstance();
}, 180_000);

afterAll(async () => {
  await instance?.dispose();
});

function extra(entity: string, table: string): ResolvedEntityExtension {
  return { moduleId: 'acme_links', origin: 'package', declaration: { entity, table }, host: ENTITY_EXTENSION_HOSTS.get(entity)! };
}

/** The recorded context, with `with` declared beside it and `without` taken out. */
function contextWith(
  options: { with?: readonly ResolvedEntityExtension[]; without?: readonly string[] } = {},
): EntityExtensionContext {
  const active = activeEntityExtensionContext();
  return {
    extensions: [
      ...active.extensions.filter((extension) => !(options.without ?? []).includes(extension.declaration.table)),
      ...(options.with ?? []),
    ],
    tables: active.tables,
  };
}

async function rolledBack(): Promise<void> {
  const [recorded] = await instance.query<{ n: number }>(
    `select count(*)::int as n from mikro_orm_migrations where name = $1`,
    [INIT],
  );
  expect(recorded?.n).toBe(0);
  const [present] = await instance.query<{ refs: string | null; notes: string | null }>(
    `select to_regclass($1)::text as refs, to_regclass($2)::text as notes`,
    [ORG_REFS, ORDER_NOTES],
  );
  expect(present).toEqual({ refs: null, notes: null });
}

async function migrateRefusal(context: EntityExtensionContext, policy?: 'warn' | 'refuse'): Promise<EntityExtensionDriftError> {
  const error = await migrateUpVerified(instance.orm, undefined, () => {}, () => {}, {
    context,
    ...(policy === undefined ? {} : { policy }),
  }).catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(EntityExtensionDriftError);
  return error as EntityExtensionDriftError;
}

function bootExec(statements?: string[]): SchemaExtensionExec {
  return (sql, params = []) => {
    statements?.push(sql);
    return instance.orm.em.getConnection().execute(sql, params, 'all') as Promise<Record<string, unknown>[]>;
  };
}

describe('the configuration resolved the fixture and the core declarations', () => {
  it('records all four declared side tables, with their origins', () => {
    expect(
      activeEntityExtensionContext()
        .extensions.map((extension) => `${extension.origin}:${extension.moduleId}:${extension.declaration.table}`)
        .sort(),
    ).toEqual([
      'core:quote_requests:quote_request_account_policies',
      'core:quote_requests:quote_request_org_policies',
      `package:acme_links:${ORDER_NOTES}`,
      `package:acme_links:${ORG_REFS}`,
    ]);
    expect(activeEntityExtensionContext().tables?.get(ORG_REFS)).toEqual({
      moduleId: 'acme_links',
      origin: 'package',
      className: 'AcmeLinksOrganizationRef',
    });
  });
});

describe('migrate up refuses a broken side table and rolls the whole run back (US2, T026)', () => {
  beforeAll(async () => {
    // Hand-made tables a declaration injected into the run will name. They are
    // outside the run, so they survive each rollback.
    await instance.query(`alter table "organizations" add column "acme_probe_id" uuid unique`);
    await instance.query(`create table "acme_links_plain" ("organization_id" uuid primary key)`);
    await instance.query(
      `create table "acme_links_wrong_host" ("organization_id" uuid primary key references "orders" ("id") on delete cascade)`,
    );
    await instance.query(
      `create table "acme_links_non_pk" ("organization_id" uuid primary key references "organizations" ("acme_probe_id") on delete cascade)`,
    );
    await instance.query(
      `create table "acme_links_restrict" ("organization_id" uuid primary key references "organizations" ("id") on delete restrict)`,
    );
  });

  afterAll(async () => {
    for (const table of ['acme_links_plain', 'acme_links_wrong_host', 'acme_links_non_pk', 'acme_links_restrict']) {
      await instance.query(`drop table if exists "${table}"`);
    }
    await instance.query(`alter table "organizations" drop column if exists "acme_probe_id"`);
  });

  it.each([
    ['P1', 'acme_links_missing', 'table-missing'],
    ['P2', 'acme_links_plain', 'foreign-key-missing'],
    ['P3 (another host)', 'acme_links_wrong_host', 'foreign-key-missing'],
    ['P3 (a non-PK column)', 'acme_links_non_pk', 'foreign-key-missing'],
    ['P4', 'acme_links_restrict', 'foreign-key-not-cascade'],
  ])('%s: %s is refused as %s, naming the module and the table', async (_rule, table, rule) => {
    const error = await migrateRefusal(contextWith({ with: [extra('organizations.Organization', table)] }));
    expect(error.findings).toEqual([expect.objectContaining({ rule, moduleId: 'acme_links', table })]);
    expect(error.message).toContain(`module "acme_links" (package)`);
    await rolledBack();
  });

  it('reports every finding of one run together', async () => {
    const error = await migrateRefusal(
      contextWith({
        with: [
          extra('organizations.Organization', 'acme_links_missing'),
          extra('organizations.Organization', 'acme_links_restrict'),
        ],
      }),
    );
    expect(error.findings.map((finding) => finding.rule).sort()).toEqual(['foreign-key-not-cascade', 'table-missing']);
    await rolledBack();
  });
});

describe('an undeclared side table (US3, T029)', () => {
  it('U1 under refuse: an entity of a composed module maps it, so migrate refuses and rolls back', async () => {
    const error = await migrateRefusal(contextWith({ without: [ORDER_NOTES] }), 'refuse');
    expect(error.findings).toEqual([
      expect.objectContaining({ rule: 'undeclared-entity-extension', moduleId: 'acme_links', table: ORDER_NOTES }),
    ]);
    expect(error.message).toContain(`extends: [{ entity: 'orders.Order', table: '${ORDER_NOTES}' }]`);
    await rolledBack();
  });
});

describe('migrate up commits a correct declaration (US1, T017)', () => {
  it('applies the fixture migration, verifies inside the run and commits', async () => {
    const warnings: string[] = [];
    const applied = await migrateUpVerified(instance.orm, undefined, (line) => warnings.push(line));
    expect(applied.map((migration) => migration.name)).toEqual([INIT]);
    expect(warnings.filter((line) => line.includes('entity-extensions'))).toEqual([]);
    const [recorded] = await instance.query<{ n: number }>(
      `select count(*)::int as n from mikro_orm_migrations where name = $1`,
      [INIT],
    );
    expect(recorded?.n).toBe(1);
  });

  it('passes the boot verification in exactly one statement, every side table verified (FR-022, FR-023)', async () => {
    const statements: string[] = [];
    const report = await verifyEntityExtensions(bootExec(statements), activeEntityExtensionContext(), () => {});
    expect(statements).toHaveLength(1);
    expect(report.queries).toBe(1);
    expect(report.warnings).toEqual([]);
    expect(report.rows.map((row) => `${row.table}:${row.status}`)).toEqual([
      'quote_request_account_policies:verified',
      `${ORDER_NOTES}:verified`,
      `${ORG_REFS}:verified`,
      'quote_request_org_policies:verified',
    ]);
    expect(report.rows.find((row) => row.table === ORG_REFS)).toEqual({
      kind: 'entity-extension',
      moduleId: 'acme_links',
      origin: 'package',
      host: 'organizations.Organization',
      hostTable: 'organizations',
      table: ORG_REFS,
      constraint: 'acme_links_organization_refs_organization_fk',
      status: 'verified',
    });
  });
});

describe('boot refuses a database altered by hand (US2 scenario 2, T026)', () => {
  async function bootFindings(): Promise<readonly { rule: string; table: string }[]> {
    const error = await verifyEntityExtensions(bootExec(), activeEntityExtensionContext(), () => {}).catch(
      (thrown: unknown) => thrown,
    );
    if (error === undefined || !(error instanceof EntityExtensionDriftError)) return [];
    return error.findings;
  }

  it('P4: a cascade turned into restrict', async () => {
    await instance.query(`alter table "${ORG_REFS}" drop constraint "acme_links_organization_refs_organization_fk"`);
    await instance.query(
      `alter table "${ORG_REFS}" add constraint "acme_links_organization_refs_organization_fk" foreign key ("organization_id") references "organizations" ("id") on delete restrict`,
    );
    try {
      expect(await bootFindings()).toEqual([expect.objectContaining({ rule: 'foreign-key-not-cascade', table: ORG_REFS })]);
    } finally {
      await instance.query(`alter table "${ORG_REFS}" drop constraint "acme_links_organization_refs_organization_fk"`);
      await instance.query(
        `alter table "${ORG_REFS}" add constraint "acme_links_organization_refs_organization_fk" foreign key ("organization_id") references "organizations" ("id") on delete cascade`,
      );
    }
  });

  it('P2: the foreign key dropped', async () => {
    await instance.query(`alter table "${ORDER_NOTES}" drop constraint "acme_links_order_notes_order_fk"`);
    try {
      expect(await bootFindings()).toEqual([expect.objectContaining({ rule: 'foreign-key-missing', table: ORDER_NOTES })]);
    } finally {
      await instance.query(
        `alter table "${ORDER_NOTES}" add constraint "acme_links_order_notes_order_fk" foreign key ("order_id") references "orders" ("id") on delete cascade`,
      );
    }
  });

  it('P1: the table gone', async () => {
    await instance.query(`alter table "${ORDER_NOTES}" rename to "acme_links_order_notes_moved"`);
    try {
      expect(await bootFindings()).toEqual([expect.objectContaining({ rule: 'table-missing', table: ORDER_NOTES })]);
    } finally {
      await instance.query(`alter table "acme_links_order_notes_moved" rename to "${ORDER_NOTES}"`);
    }
  });

  it('passes again once restored', async () => {
    expect(await bootFindings()).toEqual([]);
  });
});

describe('undeclared and unowned side tables at boot (US3, T029)', () => {
  it('U1 under warn: one warn line naming the module, the table and the entry to add; the boot passes', async () => {
    const lines: string[] = [];
    const report = await verifyEntityExtensions(bootExec(), contextWith({ without: [ORDER_NOTES] }), (line) =>
      lines.push(line),
      { policy: 'warn' },
    );
    expect(report.findings).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('undeclared-entity-extension');
    expect(lines[0]).toContain('module "acme_links" (package)');
    expect(lines[0]).toContain(`table: '${ORDER_NOTES}'`);
  });

  it.each(['warn', 'refuse'] as const)('U2 under %s: a table no composed module maps is a warning only', async (policy) => {
    await instance.query(
      `create table "legacy_order_flags" ("order_id" uuid primary key references "orders" ("id") on delete cascade)`,
    );
    try {
      const lines: string[] = [];
      const report = await verifyEntityExtensions(bootExec(), activeEntityExtensionContext(), (line) => lines.push(line), {
        policy,
      });
      expect(report.findings).toEqual([]);
      expect(lines).toEqual([expect.stringContaining('unowned-entity-extension')]);
      expect(lines[0]).toContain('"legacy_order_flags"');
      expect(report.rows.find((row) => row.table === 'legacy_order_flags')?.status).toBe('unowned');
    } finally {
      await instance.query(`drop table "legacy_order_flags"`);
    }
  });

  it('the inspection with nothing declared is still one statement (inert)', async () => {
    const statements: string[] = [];
    await inspectEntityExtensions(bootExec(statements), { extensions: [], tables: activeEntityExtensionContext().tables });
    expect(statements).toHaveLength(1);
  });
});
