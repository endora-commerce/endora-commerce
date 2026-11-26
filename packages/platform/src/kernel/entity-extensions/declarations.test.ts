import { describe, expect, it } from 'vitest';
import { judgeEntityExtensions, resolveEntityExtensions, type EntityExtensionManifest } from './declarations.js';
import { EntityExtensionInvalidError, type EntityExtensionOrigin } from './errors.js';

/**
 * `specs/187-side-table-extensions/contracts/entity-extension-declaration.md`
 * §3 — the static rules over the whole composition (E2 – E4, plus E1 and E5
 * re-asked for a manifest that did not pass through `defineModuleManifest`),
 * and §4: the origin is carried, never read (FR-005).
 */

const ORIGINS: readonly EntityExtensionOrigin[] = ['core', 'package', 'overlay'];

const hostModules: EntityExtensionManifest[] = [
  { moduleId: 'organizations', origin: 'core', dependencies: [] },
  { moduleId: 'customer_accounts', origin: 'core', dependencies: ['organizations'] },
  { moduleId: 'orders', origin: 'core', dependencies: ['customer_accounts', 'organizations'] },
];

function acme(
  declarations: readonly unknown[],
  dependencies: readonly string[] = ['organizations'],
  origin: EntityExtensionOrigin = 'package',
): EntityExtensionManifest {
  return { moduleId: 'acme_erp', origin, dependencies, extends: declarations };
}

function refusal(manifests: readonly EntityExtensionManifest[]): EntityExtensionInvalidError {
  try {
    resolveEntityExtensions(manifests);
  } catch (error) {
    if (error instanceof EntityExtensionInvalidError) return error;
    throw error;
  }
  throw new Error('expected resolveEntityExtensions to refuse');
}

const onOrganizations = { entity: 'organizations.Organization', table: 'acme_erp_organization_links' };

describe('resolveEntityExtensions — a correct declaration', () => {
  it('resolves to the declaring module, its origin, the entry and the host', () => {
    expect(resolveEntityExtensions([...hostModules, acme([onOrganizations])])).toEqual([
      {
        moduleId: 'acme_erp',
        origin: 'package',
        declaration: onOrganizations,
        host: { table: 'organizations', ownerModuleId: 'organizations', entityClassName: 'Organization' },
      },
    ]);
  });

  it('is empty, and asks nothing, for a composition that declares nothing (inert)', () => {
    expect(resolveEntityExtensions(hostModules)).toEqual([]);
    expect(resolveEntityExtensions([])).toEqual([]);
  });

  it('accepts a host owner reached transitively through dependencies (E3)', () => {
    const resolved = resolveEntityExtensions([...hostModules, acme([onOrganizations], ['orders'])]);
    expect(resolved.map((r) => r.declaration.table)).toEqual(['acme_erp_organization_links']);
  });

  it('accepts two modules extending one host, and one module extending two hosts', () => {
    const resolved = resolveEntityExtensions([
      ...hostModules,
      acme([onOrganizations, { entity: 'orders.Order', table: 'acme_erp_order_notes' }], ['orders']),
      {
        moduleId: 'acme_crm',
        origin: 'overlay',
        dependencies: ['organizations'],
        extends: [{ entity: 'organizations.Organization', table: 'acme_crm_organization_scores' }],
      },
    ]);
    expect(resolved.map((r) => `${r.moduleId}:${r.declaration.table}:${r.host.table}`)).toEqual([
      'acme_erp:acme_erp_organization_links:organizations',
      'acme_erp:acme_erp_order_notes:orders',
      'acme_crm:acme_crm_organization_scores:organizations',
    ]);
  });
});

describe('resolveEntityExtensions — the static refusals', () => {
  it('E2 refuses a host that is not extensible, listing the nine hosts', () => {
    const error = refusal([...hostModules, acme([{ entity: 'invoices.Invoice', table: 'acme_erp_invoice_links' }])]);
    expect(error.rule).toBe('host-not-extensible');
    expect(error.moduleId).toBe('acme_erp');
    expect(error.table).toBe('acme_erp_invoice_links');
    expect(error.entity).toBe('invoices.Invoice');
    for (const host of [
      'catalog.Category',
      'catalog.Product',
      'crm.CrmOpportunity',
      'customer_accounts.CustomerAccount',
      'orders.Order',
      'organizations.Organization',
      'projects.Project',
      'quote_requests.QuoteRequest',
      'tasks.Task',
    ]) {
      expect(error.message).toContain(host);
    }
  });

  it('E2 refuses a host module with the wrong class name', () => {
    expect(refusal([...hostModules, acme([{ entity: 'organizations.Org', table: 'acme_erp_x' }])]).rule).toBe(
      'host-not-extensible',
    );
  });

  it('E3 refuses a host owner outside the dependency closure — direct', () => {
    const error = refusal([...hostModules, acme([onOrganizations], [])]);
    expect(error.rule).toBe('host-not-a-dependency');
    expect(error.message).toContain('"organizations"');
    expect(error.message).toContain('dependencies');
  });

  it('E3 refuses a host owner outside the dependency closure — transitive', () => {
    const error = refusal([
      ...hostModules,
      { moduleId: 'blog', origin: 'core', dependencies: [] },
      acme([{ entity: 'orders.Order', table: 'acme_erp_order_notes' }], ['blog']),
    ]);
    expect(error.rule).toBe('host-not-a-dependency');
    expect(error.entity).toBe('orders.Order');
  });

  it('E4 refuses the host owner declaring a side table on itself', () => {
    const error = refusal([
      { moduleId: 'organizations', origin: 'core', dependencies: [], extends: [onOrganizations] },
    ]);
    expect(error.rule).toBe('self-extension');
    expect(error.moduleId).toBe('organizations');
  });

  it('E1 refuses an entry of the wrong shape that bypassed defineModuleManifest', () => {
    expect(refusal([...hostModules, acme([{ entity: 'organizations', table: 'acme_x' }])]).rule).toBe(
      'declaration-shape',
    );
    expect(refusal([...hostModules, acme([{ ...onOrganizations, extra: true }])]).rule).toBe('declaration-shape');
  });

  it('E5 refuses one table declared twice by one module', () => {
    expect(
      refusal([...hostModules, acme([onOrganizations, { entity: 'orders.Order', table: onOrganizations.table }], ['orders'])])
        .rule,
    ).toBe('duplicate-table');
  });

  it('refuses one table declared by two modules — a table has one owner', () => {
    const error = refusal([
      ...hostModules,
      acme([onOrganizations]),
      { moduleId: 'acme_crm', origin: 'package', dependencies: ['organizations'], extends: [onOrganizations] },
    ]);
    expect(error.rule).toBe('duplicate-table');
    expect(error.message).toContain('acme_erp');
  });
});

describe('the origin is carried and never read (FR-005, SC-006)', () => {
  const cases: ReadonlyArray<readonly [string, readonly unknown[], readonly string[]]> = [
    ['correct', [onOrganizations], ['organizations']],
    ['not extensible', [{ entity: 'invoices.Invoice', table: 'acme_erp_x' }], ['organizations']],
    ['not a dependency', [onOrganizations], []],
  ];

  it.each(cases)('gives identical verdicts under core, package and overlay — %s', (_label, declarations, deps) => {
    const verdicts = ORIGINS.map((origin) =>
      judgeEntityExtensions([...hostModules, acme(declarations, deps, origin)]).map((verdict) => ({
        ...verdict,
        origin: undefined,
        resolved: verdict.resolved === undefined ? undefined : { ...verdict.resolved, origin: undefined },
        error: verdict.error?.message.replace(/ \((core|package|overlay)\)/, ''),
      })),
    );
    expect(verdicts[1]).toEqual(verdicts[0]);
    expect(verdicts[2]).toEqual(verdicts[0]);
    for (const [index, origin] of ORIGINS.entries()) {
      const [verdict] = judgeEntityExtensions([...hostModules, acme(declarations, deps, origin)]);
      expect(verdict?.origin).toBe(origin);
      expect(verdicts[index]).toHaveLength(1);
    }
  });
});

describe('judgeEntityExtensions — one verdict per entry, never a throw (audit-packages)', () => {
  it('answers ok or the rule for every entry, in declaration order', () => {
    const verdicts = judgeEntityExtensions(
      [
        acme([onOrganizations, { entity: 'invoices.Invoice', table: 'acme_erp_x' }, { entity: 'orders.Order', table: 'acme_erp_y' }]),
      ],
      { dependencies: new Map([['organizations', []]]) },
    );
    expect(verdicts.map((verdict) => [verdict.table, verdict.verdict])).toEqual([
      ['acme_erp_organization_links', 'ok'],
      ['acme_erp_x', 'host-not-extensible'],
      ['acme_erp_y', 'host-not-a-dependency'],
    ]);
  });
});
