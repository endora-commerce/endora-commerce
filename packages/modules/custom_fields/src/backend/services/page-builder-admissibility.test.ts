import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { SupportedEntityType } from '@endora-commerce/contracts';
import { SUPPORTED_ENTITIES, SUPPORTED_ENTITY_TYPES } from './custom-field-registry.js';
import {
  applyCreateDefinition,
  applyUpdateDefinition,
  CustomFieldDefinitionError,
} from './custom-field-definition-apply.js';
import { coerce } from './custom-field-value.service.js';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import { CustomFieldListFilterService } from './custom-field-list-filter.service.js';
import type { CustomFieldDefinitionApplyCreateInput } from '../../ports/index.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, research R-5, FR-002,
 * FR-005): the `page_builder` value type is admissible only on an entity type
 * whose registry entry carries the `pageBuilderValues` marker — `product`
 * alone — and a definition's type never moves to or from it. No database: the
 * EntityManager is a stub that answers what each case needs.
 */

const NON_PRODUCT_HOSTS: SupportedEntityType[] = [
  'order',
  'organization',
  'customer',
  'category',
  'quote_request',
  'opportunity',
  'project',
  'task',
];

function createInput(entityType: SupportedEntityType): CustomFieldDefinitionApplyCreateInput {
  return {
    entityType,
    key: 'buying_guide',
    label: { 'en-US': 'Buying guide' },
    labelDefault: 'Buying guide',
    valueType: 'page_builder',
    required: false,
    audience: 'customer',
    sortOrder: 0,
    config: {},
    options: [],
  } as CustomFieldDefinitionApplyCreateInput;
}

/** An EntityManager that finds nothing and records what is created. */
function emptyEm(): { em: EntityManager; created: unknown[] } {
  const created: unknown[] = [];
  const em = {
    findOne: async () => null,
    find: async () => [],
    create: (_entity: unknown, data: unknown) => {
      created.push(data);
      return data;
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
  return { em, created };
}

/** An EntityManager holding exactly one definition. */
function emWith(definition: Record<string, unknown>): EntityManager {
  return {
    findOne: async () => definition,
    find: async () => [],
  } as unknown as EntityManager;
}

async function refusal(promise: Promise<unknown>): Promise<CustomFieldDefinitionError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CustomFieldDefinitionError);
  return error as CustomFieldDefinitionError;
}

describe('page_builder admissibility — the registry marker', () => {
  it('is carried by product and by no other entity type', () => {
    const offering = SUPPORTED_ENTITY_TYPES.filter(
      (type) => SUPPORTED_ENTITIES[type].pageBuilderValues === true,
    );
    expect(offering).toEqual(['product']);
  });
});

describe('page_builder admissibility — applyCreateDefinition', () => {
  for (const entityType of NON_PRODUCT_HOSTS) {
    it(`refuses a page_builder definition on ${entityType} with value_type_unsupported`, async () => {
      const { em, created } = emptyEm();
      const error = await refusal(applyCreateDefinition(em, createInput(entityType)));
      expect(error.code).toBe('value_type_unsupported');
      expect(created).toEqual([]);
    });
  }

  it('accepts a page_builder definition on product', async () => {
    const { em, created } = emptyEm();
    await applyCreateDefinition(em, createInput('product'));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entityType: 'product', valueType: 'page_builder' });
  });
});

describe('page_builder admissibility — applyUpdateDefinition', () => {
  const stored = (valueType: string) => ({
    id: 'def-1',
    entityType: 'product',
    key: 'guide',
    valueType,
    carryTo: [],
  });

  it('refuses a change to page_builder with value_type_locked, whatever the stored values', async () => {
    const definition = stored('text');
    const error = await refusal(applyUpdateDefinition(emWith(definition), 'def-1', { valueType: 'page_builder' }));
    expect(error.code).toBe('value_type_locked');
    expect(definition.valueType).toBe('text');
  });

  it('refuses a change away from page_builder with value_type_locked', async () => {
    const definition = stored('page_builder');
    const error = await refusal(applyUpdateDefinition(emWith(definition), 'def-1', { valueType: 'text' }));
    expect(error.code).toBe('value_type_locked');
    expect(definition.valueType).toBe('page_builder');
  });

  it('allows a page_builder definition to be patched without a type change', async () => {
    const definition = stored('page_builder');
    await applyUpdateDefinition(emWith(definition), 'def-1', {
      valueType: 'page_builder',
      labelDefault: 'Guide',
    });
    expect(definition).toMatchObject({ valueType: 'page_builder', labelDefault: 'Guide' });
  });
});

describe('page_builder — the generic value path and list filters', () => {
  it('coerces nothing: a page_builder value is wrong_type', () => {
    const result = coerce('page_builder', { languages: {} }, []);
    expect(result).toMatchObject({ code: 'wrong_type' });
    expect((result as { message: string }).message).toMatch(/Page Builder/);
  });

  it('builds no list-filter predicate for a page_builder field', async () => {
    const definition = {
      definition: {
        id: 'def-guide',
        entityType: 'order',
        key: 'guide',
        label: {},
        labelDefault: 'guide',
        valueType: 'page_builder',
        listFilter: true,
        sortOrder: 0,
      },
      options: [],
    } as unknown as CachedDefinition;
    const port = new CustomFieldListFilterService({ listForEntity: async () => [definition] }, () => true);
    // No operator applies to the type, so the only filter it can be given is
    // an empty one — which contributes no predicate.
    expect(await port.condition('order', { guide: {} })).toBeNull();
    // Any operator is refused, never ignored.
    const error = await port.condition('order', { guide: { contains: 'x' } }).catch((caught: unknown) => caught);
    expect((error as { name?: string }).name).toBe('ZodError');
  });
});
