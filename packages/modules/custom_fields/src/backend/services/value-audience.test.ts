import { describe, expect, it } from 'vitest';
import {
  createCustomFieldDefinitionSchema,
  updateCustomFieldDefinitionSchema,
  type CustomFieldAudience,
} from '@endora-commerce/contracts';
import { CustomFieldValueService, type DefinitionSource } from './custom-field-value.service.js';
import type { CachedDefinition } from './custom-field-definitions-cache.js';

/**
 * `projectForCustomer` is the one filter between a stored custom-field bag and
 * a non-administrator. It answers a key only when a live definition says the
 * customer may read it.
 */
function source(defs: Array<{ key: string; audience: CustomFieldAudience }>): DefinitionSource & {
  loads: number;
} {
  const cached = defs.map(
    (d) => ({ definition: { key: d.key, audience: d.audience }, options: [] }) as unknown as CachedDefinition,
  );
  const self = {
    loads: 0,
    listForEntity: async (entityType: string) => {
      self.loads += 1;
      return entityType === 'order' ? cached : [];
    },
  };
  return self;
}

describe('CustomFieldValueService.projectForCustomer', () => {
  const defs = [
    { key: 'gift_note', audience: 'customer' as const },
    { key: 'internal_note', audience: 'internal' as const },
  ];

  it('answers a customer-visible value and withholds an internal one', async () => {
    const service = new CustomFieldValueService(source(defs));
    expect(
      await service.projectForCustomer('order', { gift_note: 'Happy birthday', internal_note: 'call first' }),
    ).toEqual({ gift_note: 'Happy birthday' });
  });

  it('withholds a value whose definition no longer exists', async () => {
    const service = new CustomFieldValueService(source(defs));
    expect(await service.projectForCustomer('order', { deleted_field: 'x' })).toEqual({});
  });

  it('judges a key by the definition of the entity type asked about, not by its name', async () => {
    const service = new CustomFieldValueService(source(defs));
    // `gift_note` is customer-visible on an order; nothing defines it on a quote.
    expect(await service.projectForCustomer('quote_request', { gift_note: 'x' })).toEqual({});
  });

  it('does not answer inherited object keys as if they were fields', async () => {
    const service = new CustomFieldValueService(
      source([{ key: 'constructor', audience: 'customer' }]),
    );
    expect(await service.projectForCustomer('order', { internal_note: 'x' })).toEqual({});
  });

  it('reads no definitions for an empty bag', async () => {
    const src = source(defs);
    expect(await new CustomFieldValueService(src).projectForCustomer('order', {})).toEqual({});
    expect(src.loads).toBe(0);
  });
});

describe('the audience on the definition requests', () => {
  const base = {
    entityType: 'order',
    key: 'internal_note',
    label: {},
    labelDefault: 'Internal note',
    valueType: 'text',
    required: false,
    sortOrder: 0,
  };

  it('a definition created without an audience is internal', () => {
    expect(createCustomFieldDefinitionSchema.parse(base).audience).toBe('internal');
    expect(
      createCustomFieldDefinitionSchema.parse({ ...base, audience: 'customer' }).audience,
    ).toBe('customer');
  });

  it('a patch that does not name the audience leaves it alone', () => {
    expect(updateCustomFieldDefinitionSchema.parse({ required: true })).not.toHaveProperty(
      'audience',
    );
    expect(updateCustomFieldDefinitionSchema.parse({ audience: 'internal' }).audience).toBe(
      'internal',
    );
  });

  it('a patch that names only the audience carries no `config` to overwrite the stored one', () => {
    expect(updateCustomFieldDefinitionSchema.parse({ audience: 'customer' })).not.toHaveProperty(
      'config',
    );
  });

  it('refuses an audience it does not know', () => {
    expect(createCustomFieldDefinitionSchema.safeParse({ ...base, audience: 'everyone' }).success).toBe(
      false,
    );
  });
});
