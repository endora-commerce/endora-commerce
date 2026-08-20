import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomFieldDefinition } from '../modules/custom_fields/entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../modules/custom_fields/entities/custom-field-option.entity.js';
import { ProductAttribute } from '../modules/catalog/entities/product-attribute.entity.js';
import {
  legacyToCfType,
  type LegacyAttributeValueType,
} from '../modules/catalog/services/attribute-type-mapping.js';

/**
 * Seed/fixture helpers for the feature-061 unified attribute model.
 *
 * A product attribute is a `custom_field_definitions` row
 * (`entity_type='product'`, generic identity) paired 1:1 with a
 * `product_attributes` extension row (catalog flags + presentation
 * refinements). These helpers create/read the pair in the legacy one-shot
 * shape so seeds and test fixtures stay mechanical.
 *
 * SEED-LEVEL CODE ONLY: runtime services never touch the custom_fields
 * entities directly — they go through the apply seam / composed view
 * (Principle I). Seeds are composition-level bootstrap, like migrations.
 *
 * Feature 075 took that sentence at its word and moved the file out of
 * `src/modules/catalog/seeds/`. Its two consumers are `dev-catalog-seed.ts`
 * beside it and `test/helpers/seed-catalog.ts`; no runtime path reaches it. A
 * file that writes both `custom_field_definitions` and `product_attributes` in
 * one call is composition, and composition is allowed to name modules — which
 * is why the paragraph above was true and the location was not.
 */

export interface AttributeFixtureInput {
  /** Extension row id (the id the admin API exposes). Random when omitted. */
  id?: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  /** Legacy 8-value form; mapped onto the cf triple per research §R7. */
  valueType: LegacyAttributeValueType;
  isRequired?: boolean;
  sortOrder?: number;
  isSearchable?: boolean;
  isFilterable?: boolean;
  isVariantAxis?: boolean;
  displayAsSlider?: boolean;
  isComparable?: boolean;
  quickSearchable?: boolean;
  isPromoRule?: boolean;
  filterPosition?: number;
  isVisibleOnProductPage?: boolean;
  channelScoped?: boolean;
  languageScoped?: boolean;
  massEditable?: boolean;
  options?: Array<{
    value: string;
    label?: Record<string, string>;
    labelDefault?: string;
    isDefault?: boolean;
    sortOrder?: number;
  }>;
}

export interface AttributeFixture {
  extension: ProductAttribute;
  definition: CustomFieldDefinition;
}

/** Create a definition + extension pair (+ options) in one flush. */
export async function createAttributeFixture(
  em: EntityManager,
  input: AttributeFixtureInput,
): Promise<AttributeFixture> {
  // command-coverage-ignore: development fixture data. Reached only from
  // `dev-catalog-seed` (`pnpm seed:dev`) and from tests, never from a request or
  // a worker — there is no operator and no production database behind it.
  const triple = legacyToCfType(input.valueType);
  const definition = em.create(CustomFieldDefinition, {
    entityType: 'product',
    key: input.key,
    label: input.label,
    labelDefault: input.labelDefault,
    valueType: triple.cfValueType,
    required: input.isRequired ?? false,
    sortOrder: input.sortOrder ?? 0,
    config: {},
  });
  await em.persistAndFlush(definition);

  for (const [i, o] of (input.options ?? []).entries()) {
    em.create(CustomFieldOption, {
      definitionId: definition.id,
      value: o.value,
      label: o.label ?? {},
      labelDefault: o.labelDefault ?? o.value,
      isDefault: o.isDefault ?? false,
      sortOrder: o.sortOrder ?? i,
    });
  }

  const extension = em.create(ProductAttribute, {
    ...(input.id !== undefined ? { id: input.id } : {}),
    customFieldDefinitionId: definition.id,
    selectDisplay: triple.selectDisplay,
    numericKind: triple.numericKind,
    isSearchable: input.isSearchable ?? false,
    isFilterable: input.isFilterable ?? false,
    isVariantAxis: input.isVariantAxis ?? false,
    displayAsSlider: input.displayAsSlider ?? false,
    isComparable: input.isComparable ?? false,
    quickSearchable: input.quickSearchable ?? false,
    isPromoRule: input.isPromoRule ?? false,
    filterPosition: input.filterPosition ?? 0,
    isVisibleOnProductPage: input.isVisibleOnProductPage ?? false,
    channelScoped: input.channelScoped ?? false,
    languageScoped: input.languageScoped ?? false,
    massEditable: input.massEditable ?? false,
  });
  await em.persistAndFlush(extension);
  return { extension, definition };
}

/** Resolve the extension row for a product attribute by its definition key. */
export async function findAttributeExtensionByKey(
  em: EntityManager,
  key: string,
): Promise<ProductAttribute | null> {
  const definition = await em.findOne(CustomFieldDefinition, { entityType: 'product', key });
  if (!definition) return null;
  return em.findOne(ProductAttribute, { customFieldDefinitionId: definition.id });
}

/** Resolve the definition backing an extension row's key (test convenience). */
export async function findAttributeDefinitionByKey(
  em: EntityManager,
  key: string,
): Promise<CustomFieldDefinition | null> {
  return em.findOne(CustomFieldDefinition, { entityType: 'product', key });
}
