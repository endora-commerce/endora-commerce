import { describe, expect, it } from 'vitest';
import {
  EXTENSIBLE_HOST_TABLES,
  ExtensionAttributesSchema,
  ExtensionsQuerySchema,
  type ExtensibleHostTable,
} from './schema-extensions.js';
import { CUSTOM_FIELD_HOST_BINDINGS } from './custom-fields.js';

/** `specs/178-extensible-columns/` FR-050, data-model §7. */
describe('ExtensionsQuerySchema', () => {
  it('accepts an absent parameter', () => {
    expect(ExtensionsQuerySchema.parse({})).toEqual({});
  });

  it('accepts one to eight comma-separated module ids', () => {
    expect(ExtensionsQuerySchema.parse({ extensions: 'acme_erp' })).toEqual({ extensions: 'acme_erp' });
    const eight = Array.from({ length: 8 }, (_, i) => `m${i}`).join(',');
    expect(ExtensionsQuerySchema.safeParse({ extensions: eight }).success).toBe(true);
  });

  it('refuses nine ids, an empty member, an upper-case id and whitespace', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `m${i}`).join(',');
    for (const extensions of [nine, 'a,,b', 'Acme', 'a, b', '', '1abc']) {
      expect(ExtensionsQuerySchema.safeParse({ extensions }).success).toBe(false);
    }
  });
});

describe('ExtensionAttributesSchema', () => {
  it('is a record of module ids to a record of JSON values', () => {
    const value = {
      acme_erp: { erpCode: 'ERP-1', creditTier: 0, onboardedVia: null, meta: { a: [1, true] } },
    };
    expect(ExtensionAttributesSchema.parse(value)).toEqual(value);
  });

  it('refuses a key that is not a module id', () => {
    expect(ExtensionAttributesSchema.safeParse({ 'Not-A-Module': {} }).success).toBe(false);
  });
});

describe('ExtensibleHostTable', () => {
  it('is the set of tables the custom-field host bindings name', () => {
    expect([...EXTENSIBLE_HOST_TABLES].sort()).toEqual(
      Object.values(CUSTOM_FIELD_HOST_BINDINGS)
        .map((binding) => binding.table)
        .sort(),
    );
    const table: ExtensibleHostTable = 'organizations';
    expect(EXTENSIBLE_HOST_TABLES).toContain(table);
  });
});
