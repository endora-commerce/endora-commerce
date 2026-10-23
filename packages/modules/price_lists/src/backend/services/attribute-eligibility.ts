import type { AttributeValueType, CatalogAttributeView } from '@endora-commerce/contracts';

/** Why an attribute row cannot select prices at the moment (it stays, inactive). */
export type AttributeInactiveReason =
  | 'attribute_not_found'
  | 'attribute_not_flagged'
  | 'attribute_language_scoped'
  | 'attribute_channel_scoped'
  | 'attribute_value_type';

/**
 * Attribute eligibility for price selections — feature 148, kept by feature 160
 * (D-287 §5.9): an attribute row prices only on an attribute flagged *Price list
 * rules* (`isPriceRule`) whose values are a closed vocabulary (`select`, `enum`,
 * `multiselect`, `boolean`) and which is neither per-language nor per-channel.
 *
 * The same answer serves the write-time refusal and resolution, where an
 * attribute that stops qualifying silently makes its rows inert and resumes them
 * when it qualifies again (FR-007). Moved here from `matrix-price-resolver.ts`,
 * which the removal phase deletes, so the price-book resolver depends on
 * nothing that goes with the old model.
 */

/** The value types an attribute selection can match (research R6). */
export type EligibleAttributeValueType = 'select' | 'enum' | 'multiselect' | 'boolean';

/** An attribute the matrix may currently select on. */
export interface EligibleAttribute {
  key: string;
  valueType: EligibleAttributeValueType;
}

const ELIGIBLE_VALUE_TYPES: ReadonlySet<AttributeValueType> = new Set<AttributeValueType>([
  'select',
  'enum',
  'multiselect',
  'boolean',
]);

/**
 * Why an attribute cannot select prices right now, or `null` when it can.
 *
 * The same answer serves the write-time refusal (`PRICE_BOOK_ROW_TARGET`, `attribute_not_selectable`),
 * the admin DTO's `inactiveReason`, and — through {@link buildEligibleAttributes}
 * — resolution, where an ineligible attribute silently makes its entries not
 * candidates (FR-010: unflagging an attribute must never break checkout).
 */
export function attributeInactiveReason(
  view: Pick<CatalogAttributeView, 'isPriceRule' | 'languageScoped' | 'channelScoped' | 'valueType'> | null,
): AttributeInactiveReason | null {
  if (!view) return 'attribute_not_found';
  if (!view.isPriceRule) return 'attribute_not_flagged';
  if (view.languageScoped) return 'attribute_language_scoped';
  if (view.channelScoped) return 'attribute_channel_scoped';
  if (!ELIGIBLE_VALUE_TYPES.has(view.valueType)) return 'attribute_value_type';
  return null;
}

/**
 * The attributes the matrix may select on, keyed by attribute key — built from
 * `catalogAttributeReadPort.listByFlag('isPriceRule')` (contract §4).
 */
export function buildEligibleAttributes(
  views: readonly CatalogAttributeView[],
): Map<string, EligibleAttribute> {
  const out = new Map<string, EligibleAttribute>();
  for (const view of views) {
    if (attributeInactiveReason(view) !== null) continue;
    out.set(view.key, { key: view.key, valueType: view.valueType as EligibleAttributeValueType });
  }
  return out;
}

/**
 * Whether a product's stored attribute value matches an entry's value
 * (contract §5). Option codes compare as stored — a label edit or a language
 * cannot break an entry. A missing value never matches, not even `'false'`.
 */
export function matchesAttributeValue(
  valueType: EligibleAttributeValueType,
  productValue: unknown,
  entryValue: string,
): boolean {
  switch (valueType) {
    case 'select':
    case 'enum':
      return typeof productValue === 'string' && productValue === entryValue;
    case 'multiselect':
      return Array.isArray(productValue) && productValue.includes(entryValue);
    case 'boolean':
      return (
        (productValue === true && entryValue === 'true') ||
        (productValue === false && entryValue === 'false')
      );
  }
}
