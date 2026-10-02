/**
 * Seed and fixture helpers for the feature-061 unified attribute model.
 *
 * A product attribute is a `custom_field_definitions` row
 * (`entity_type='product'`, generic identity) paired 1:1 with a
 * `product_attributes` extension row (catalog flags and presentation
 * refinements). These helpers create and read the pair in the legacy one-shot
 * shape, so the demo composition and the host's test fixtures stay mechanical.
 *
 * SEED-LEVEL CODE ONLY: runtime services never touch the `custom_fields`
 * entities directly — they go through the apply seam and the composed view
 * (Principle I). A file that writes both `custom_field_definitions` and
 * `product_attributes` in one call is composition, and composition is allowed
 * to name modules.
 *
 * ## Why it is in this package
 *
 * It was `backend/src/seeds/attribute-fixtures.ts`, beside the composition that
 * calls it. The composition moved here so that an instance scaffolded by the
 * CLI can run it, and this file moved with it rather than being copied: it is
 * the one copy of the helper (feature 113 FR-019), and the host's
 * `test/helpers/seed-catalog.ts` imports it from here.
 *
 * ## Why the row types are written here
 *
 * A module package publishes one `entities` array and no entity class by name
 * (D-168), so `entityNamed` takes each class off the array the ORM registered
 * and the row type is a parameter. The host used to name that type through an
 * `import type` into the module package's built `dist/`, which is a path in
 * this repository and in no client's install. The interfaces below are the
 * columns this file writes and its callers read — structural, so the class the
 * array returns satisfies them, and `Opt<>` marks the columns the entity
 * defaults so `em.create` does not demand them.
 *
 * Every module is imported **when a helper runs**, never at load: an instance
 * that does not install `catalog` or `custom_fields` can still load this
 * package, and the composition guards every step on both modules' presence
 * before it gets here.
 */
import type { EntityManager, Opt } from '@mikro-orm/postgresql';
import { entityNamed } from '@endora-commerce/platform/packages';
import type { LegacyAttributeValueType } from '@endora-commerce/mod-catalog/backend';

/** A `custom_field_definitions` row, as far as attribute fixtures read and write it. */
export interface CustomFieldDefinitionRow {
  id: Opt<string>;
  entityType: string;
  key: string;
  label: Opt<Record<string, string>>;
  labelDefault: string;
  valueType: string;
  required: Opt<boolean>;
  sortOrder: Opt<number>;
  config: Opt<Record<string, unknown>>;
  createdAt: Opt<Date>;
  updatedAt: Opt<Date>;
}

/** A `custom_field_options` row. */
export interface CustomFieldOptionRow {
  id: Opt<string>;
  definitionId: string;
  value: string;
  label: Opt<Record<string, string>>;
  labelDefault: string;
  isDefault: Opt<boolean>;
  sortOrder: Opt<number>;
  createdAt: Opt<Date>;
  updatedAt: Opt<Date>;
}

/** A `product_attributes` extension row — `catalog`'s flags over a definition. */
export interface ProductAttributeRow {
  id: Opt<string>;
  customFieldDefinitionId: string;
  selectDisplay: 'pill' | 'dropdown' | null;
  numericKind: 'number' | 'price' | null;
  isSearchable: Opt<boolean>;
  isFilterable: Opt<boolean>;
  isVariantAxis: Opt<boolean>;
  displayAsSlider: Opt<boolean>;
  isComparable: Opt<boolean>;
  quickSearchable: Opt<boolean>;
  isPromoRule: Opt<boolean>;
  filterPosition: Opt<number>;
  isVisibleOnProductPage: Opt<boolean>;
  channelScoped: Opt<boolean>;
  languageScoped: Opt<boolean>;
  massEditable: Opt<boolean>;
  createdAt: Opt<Date>;
  updatedAt: Opt<Date>;
}

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
  extension: ProductAttributeRow;
  definition: CustomFieldDefinitionRow;
}

const CUSTOM_FIELDS = '@endora-commerce/mod-custom-fields/backend';
const CATALOG = '@endora-commerce/mod-catalog/backend';

/**
 * The three entity classes, off the arrays the two packages publish.
 *
 * Imported on call rather than at load — see the header. `legacyToCfType` comes
 * from `catalog` by name: it is a pure mapping function, not an entity, so D-168
 * does not bar the door.
 */
async function attributeClasses() {
  const [customFields, catalog] = await Promise.all([
    import('@endora-commerce/mod-custom-fields/backend'),
    import('@endora-commerce/mod-catalog/backend'),
  ]);
  return {
    CustomFieldDefinition: entityNamed<CustomFieldDefinitionRow>(
      customFields.entities,
      'CustomFieldDefinition',
      CUSTOM_FIELDS,
    ),
    CustomFieldOption: entityNamed<CustomFieldOptionRow>(
      customFields.entities,
      'CustomFieldOption',
      CUSTOM_FIELDS,
    ),
    ProductAttribute: entityNamed<ProductAttributeRow>(
      catalog.entities,
      'ProductAttribute',
      CATALOG,
    ),
    legacyToCfType: catalog.legacyToCfType,
  };
}

/** Create a definition + extension pair (+ options) in one flush. */
export async function createAttributeFixture(
  em: EntityManager,
  input: AttributeFixtureInput,
): Promise<AttributeFixture> {
  // command-coverage-ignore: development fixture data. Reached only from the
  // demo composition and from tests, never from a request or a worker — there
  // is no operator and no production database behind it.
  const { CustomFieldDefinition, CustomFieldOption, ProductAttribute, legacyToCfType } =
    await attributeClasses();
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

/** Look up a product attribute's extension row by its definition key. */
export async function findAttributeExtensionByKey(
  em: EntityManager,
  key: string,
): Promise<ProductAttributeRow | null> {
  const { CustomFieldDefinition, ProductAttribute } = await attributeClasses();
  const definition = await em.findOne(CustomFieldDefinition, { entityType: 'product', key });
  if (!definition) return null;
  return em.findOne(ProductAttribute, { customFieldDefinitionId: definition.id });
}

/** Look up a product attribute's definition row by its key. */
export async function findAttributeDefinitionByKey(
  em: EntityManager,
  key: string,
): Promise<CustomFieldDefinitionRow | null> {
  const { CustomFieldDefinition } = await attributeClasses();
  return em.findOne(CustomFieldDefinition, { entityType: 'product', key });
}
