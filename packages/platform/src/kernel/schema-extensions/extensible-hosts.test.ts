import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_HOST_BINDINGS } from '@endora-commerce/contracts';
import {
  ENTITY_EXTENSION_HOSTS,
  EXTENSIBLE_HOSTS,
  SCHEMA_EXTENSION_ROLLOUT,
  rolledOutExtensibleHosts,
} from './extensible-hosts.js';
import { validateDeclarationContext } from './validate.js';
import { defineColumnExtension } from './define.js';
import { SchemaExtensionInvalidError } from './errors.js';

/** `specs/178-extensible-columns/` FR-010, FR-011. */
describe('EXTENSIBLE_HOSTS', () => {
  it('is derived from the custom-field host bindings — every bound table, its owner', () => {
    const expected = new Map(
      Object.values(CUSTOM_FIELD_HOST_BINDINGS).map((b) => [b.table, b.ownerModuleId] as const),
    );
    expect(new Map([...EXTENSIBLE_HOSTS].map(([table, host]) => [table, host.ownerModuleId]))).toEqual(
      expected,
    );
    expect(EXTENSIBLE_HOSTS.size).toBe(9);
  });
});

describe('the Phase B rollout constant', () => {
  it('rolls out organizations alone (OD-178-4, D-291)', () => {
    expect(SCHEMA_EXTENSION_ROLLOUT).toEqual(['organizations']);
    expect([...rolledOutExtensibleHosts()]).toEqual([
      ['organizations', { table: 'organizations', ownerModuleId: 'organizations' }],
    ]);
  });

  it('accepts organizations at discovery', () => {
    const declaration = defineColumnExtension({
      host: 'organizations',
      module: 'acme_erp',
      columns: { note: { type: 'text', nullable: true } },
    });
    expect(
      validateDeclarationContext([declaration], {
        hosts: rolledOutExtensibleHosts(),
        packageModuleId: 'acme_erp',
        dependencyClosure: new Set(['organizations']),
      }),
    ).toEqual([declaration]);
  });

  it('makes every other host refuse V2 at discovery', () => {
    for (const table of [...EXTENSIBLE_HOSTS.keys()].filter((host) => host !== 'organizations')) {
      const declaration = defineColumnExtension({
        host: table as 'organizations',
        module: 'acme_erp',
        columns: { note: { type: 'text', nullable: true } },
      });
      let thrown: unknown;
      try {
        validateDeclarationContext([declaration], {
          hosts: rolledOutExtensibleHosts(),
          packageModuleId: 'acme_erp',
          dependencyClosure: new Set([EXTENSIBLE_HOSTS.get(table)!.ownerModuleId]),
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SchemaExtensionInvalidError);
      expect((thrown as SchemaExtensionInvalidError).rule).toBe('host-not-extensible');
    }
  });
});

/**
 * `specs/187-side-table-extensions/contracts/entity-extension-declaration.md`
 * §2 (research R-3) — the hosts a side table may extend, keyed by the
 * declaration's `<ownerModuleId>.<EntityClassName>` reference. Every binding,
 * with no rollout constant: a side table writes nothing on its host.
 */
describe('ENTITY_EXTENSION_HOSTS (187 T007)', () => {
  it('holds every binding under <owner>.<Class>, with its table, owner and class name', () => {
    expect(ENTITY_EXTENSION_HOSTS.size).toBe(9);
    for (const binding of Object.values(CUSTOM_FIELD_HOST_BINDINGS)) {
      expect(ENTITY_EXTENSION_HOSTS.get(`${binding.ownerModuleId}.${binding.entityClassName}`)).toEqual({
        table: binding.table,
        ownerModuleId: binding.ownerModuleId,
        entityClassName: binding.entityClassName,
      });
    }
  });

  it('is not narrowed by the D2 rollout constant', () => {
    expect([...ENTITY_EXTENSION_HOSTS.keys()].sort()).toEqual([
      'catalog.Category',
      'catalog.Product',
      'crm.CrmOpportunity',
      'customer_accounts.CustomerAccount',
      'orders.Order',
      'organizations.Organization',
      'projects.Project',
      'quote_requests.QuoteRequest',
      'tasks.Task',
    ]);
    expect(SCHEMA_EXTENSION_ROLLOUT.length).toBeLessThan(ENTITY_EXTENSION_HOSTS.size);
  });
});
