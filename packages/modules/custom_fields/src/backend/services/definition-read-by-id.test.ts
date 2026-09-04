import { describe, expect, it } from 'vitest';

import { CustomFieldDefinitionReadService } from './custom-field-read-port.js';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import type { FreshDefinitionSource } from './custom-field-read-port.js';

/**
 * Feature 080, T053(b) — `getById` answers with published records.
 *
 * The definition service answers this question with `CachedDefinition`, which
 * holds the two ORM entities. `catalog` took it off the apply seam and typed
 * the result as `CustomFieldDefinitionWithOptions`; the entities are
 * structurally assignable to the records, so `tsc` said nothing and the
 * consumer held managed rows it could have mutated and flushed on whatever
 * transaction it was holding — the ability D-77's first narrowing removed from
 * every other apply-seam return.
 *
 * The published read port is the adapter, so the assertion is identity: what
 * comes out must not be the object that went in.
 */

const NOW = new Date('2026-02-02T00:00:00Z');

function cached(): CachedDefinition {
  return {
    definition: {
      id: 'def-1',
      entityType: 'product',
      key: 'material',
      label: { en: 'Material' },
      labelDefault: 'Material',
      valueType: 'select',
      required: true,
      sortOrder: 3,
      config: { filterable: true },
      createdAt: NOW,
      updatedAt: NOW,
      // The field an entity carries and a record does not — a copy drops it,
      // a hand-back keeps it.
      toJSON: () => ({}),
    },
    options: [
      {
        id: 'opt-1',
        definitionId: 'def-1',
        value: 'steel',
        label: { en: 'Steel' },
        labelDefault: 'Steel',
        isDefault: true,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  } as unknown as CachedDefinition;
}

function sourceFor(row: CachedDefinition | null): FreshDefinitionSource {
  return {
    listForEntity: async () => [],
    listForEntityFresh: async () => [],
    getById: async () => row,
  };
}

describe('CustomFieldDefinitionReadPort.getById', () => {
  it('maps the owner rows onto the published records instead of handing them out', async () => {
    const row = cached();
    const found = await new CustomFieldDefinitionReadService(sourceFor(row)).getById('def-1');

    expect(found).not.toBeNull();
    expect(found?.definition).not.toBe(row.definition);
    expect(found?.options[0]).not.toBe(row.options[0]);
    expect(found?.definition).toEqual({
      id: 'def-1',
      entityType: 'product',
      key: 'material',
      label: { en: 'Material' },
      labelDefault: 'Material',
      valueType: 'select',
      required: true,
      sortOrder: 3,
      config: { filterable: true },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(found?.options.map((o) => o.value)).toEqual(['steel']);
  });

  it('answers null for a definition the store does not hold', async () => {
    expect(await new CustomFieldDefinitionReadService(sourceFor(null)).getById('gone')).toBeNull();
  });
});
