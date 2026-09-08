import type { EntityManager } from '@mikro-orm/postgresql';
import { entities as customFieldsEntities } from '@endora-commerce/mod-custom-fields/backend';
import type { CustomFieldDefinition as CustomFieldDefinitionRow } from '../../../packages/modules/custom_fields/dist/backend/entities/custom-field-definition.entity.js';
import type { CustomFieldOption as CustomFieldOptionRow } from '../../../packages/modules/custom_fields/dist/backend/entities/custom-field-option.entity.js';
import { entityNamed } from '../packages/package-entity-lookup.js';
import { entities as catalogEntities } from '@endora-commerce/mod-catalog/backend';
import {
  legacyToCfType,
  type LegacyAttributeValueType,
} from '@endora-commerce/mod-catalog/backend';
import type { ProductAttribute as ProductAttributeRow } from '../../../packages/modules/catalog/dist/backend/entities/product-attribute.entity.js';

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

/**
 * The two `custom_fields` entity classes this file constructs (feature 080,
 * T040b — criterion 7).
 *
 * `custom_fields` is a workspace package, and a module package publishes one
 * `entities` array and no entity class by name (D-168). `entityNamed` takes each
 * off the array the ORM itself registered — `entities-registry.generated.ts`
 * imports the same export — so there is one copy in the process (D-160.6.1),
 * and the row type comes from an `import type` of the declaration inside the
 * package's **built** artefact. `dist` and not `src`: `tsconfig.build.json` sets
 * `rootDir: ./src`, and a `.ts` outside it is TS6059 even for a type-only
 * import, because such an import still joins the program.
 *
 * The array publishes two classes, so the union `find` returns would collapse to
 * whichever constituent TypeScript picks — which is what makes the row type
 * load-bearing here rather than decorative. `catalog`'s array publishes
 * **eighteen**, the widest in the tree, so the same is true of `ProductAttribute`
 * with room to spare.
 *
 * `legacyToCfType` comes from the same package by name rather than by path: it is
 * a pure mapping function, not an entity, so D-168 does not bar the door, and the
 * bare specifier is what keeps this file inside `rootDir` (see above).
 */
const CustomFieldDefinition = entityNamed<CustomFieldDefinitionRow>(
  customFieldsEntities,
  'CustomFieldDefinition',
  '@endora-commerce/mod-custom-fields/backend',
);
const CustomFieldOption = entityNamed<CustomFieldOptionRow>(
  customFieldsEntities,
  'CustomFieldOption',
  '@endora-commerce/mod-custom-fields/backend',
);
const ProductAttribute = entityNamed<ProductAttributeRow>(
  catalogEntities,
  'ProductAttribute',
  '@endora-commerce/mod-catalog/backend',
);

export interface AttributeFixture {
  extension: ProductAttributeRow;
  definition: CustomFieldDefinitionRow;
}

/** Create a definition + extension pair (+ options) in one flush. */
export async function createAttributeFixture(
  em: EntityManager,
  input: AttributeFixtureInput,
): Promise<AttributeFixture> {
  // command-coverage-ignore: development fixture data. Reached only from
  // `dev-catalog-seed` and from tests, never from a request or
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
): Promise<ProductAttributeRow | null> {
  const definition = await em.findOne(CustomFieldDefinition, { entityType: 'product', key });
  if (!definition) return null;
  return em.findOne(ProductAttribute, { customFieldDefinitionId: definition.id });
}

/** Resolve the definition backing an extension row's key (test convenience). */
export async function findAttributeDefinitionByKey(
  em: EntityManager,
  key: string,
): Promise<CustomFieldDefinitionRow | null> {
  return em.findOne(CustomFieldDefinition, { entityType: 'product', key });
}
