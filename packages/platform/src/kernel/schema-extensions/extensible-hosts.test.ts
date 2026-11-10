import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_HOST_BINDINGS } from '@endora-commerce/contracts';
import {
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

describe('the Phase A rollout constant', () => {
  it('rolls out no host yet', () => {
    expect(SCHEMA_EXTENSION_ROLLOUT).toEqual([]);
    expect(rolledOutExtensibleHosts().size).toBe(0);
  });

  it('makes every host refuse V2 at discovery', () => {
    for (const table of EXTENSIBLE_HOSTS.keys()) {
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
