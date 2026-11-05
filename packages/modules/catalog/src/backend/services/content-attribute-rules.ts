import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, research R-6) — what a
 * Page Builder content attribute may be.
 *
 * Its value is a document per language, stored apart from the product's
 * ordinary attribute values, so every capability that hands an attribute's
 * value to a consumer of short scalar values is held off. Holding them off is
 * what keeps the attribute out of search, filters, comparison, promotions,
 * price lists, bulk edit, per-channel overrides and "Parametry" by
 * construction (research R-6, R-15).
 *
 * Feature 174 (`specs/174-product-editor-scope-switcher/`, FR-012) replaced the
 * channel and language scope flags with one `scopable` flag, which means
 * "has values at Channel and Channel × language". A content attribute's
 * languages are its envelope's, not scoped values, so `scopable` is one more
 * locked capability: it carries FR-040's per-channel refusal, and FR-004's
 * "always language-scoped" is the envelope itself. Both attribute Commands call this with the
 * **effective** flags — on update, the stored flags with the patch applied — so
 * a PATCH that switches one flag on is judged against the stored type.
 *
 * A refusal, never a silent coercion: an integration must not believe it made
 * a content attribute searchable (US1 #2).
 */

/** The capabilities a content attribute holds off (FR-003). */
export const CONTENT_ATTRIBUTE_LOCKED_FLAGS = [
  'isSearchable',
  'isFilterable',
  'isVariantAxis',
  'displayAsSlider',
  'isComparable',
  'quickSearchable',
  'isPromoRule',
  'isPriceRule',
  'massEditable',
  'isRequired',
  'isVisibleOnProductPage',
  'scopable',
] as const;
export type ContentAttributeLockedFlag = (typeof CONTENT_ATTRIBUTE_LOCKED_FLAGS)[number];

export type ContentAttributeFlags = Partial<Record<ContentAttributeLockedFlag, boolean | undefined>>;

const ISSUE = 'not available for Page Builder content';

/**
 * Refuse every locked capability switched on (FR-003, FR-040), one `details`
 * entry per offending field.
 */
export function assertContentAttributeShape(flags: ContentAttributeFlags): void {
  const details: Array<{ path: string; issue: string }> = [];
  for (const flag of CONTENT_ATTRIBUTE_LOCKED_FLAGS) {
    if (flags[flag] === true) details.push({ path: flag, issue: ISSUE });
  }
  if (details.length > 0) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      `Page Builder content attributes cannot have: ${details.map((detail) => detail.path).join(', ')}.`,
      details,
    );
  }
}

/**
 * The value type of an attribute never moves to or from `page_builder`
 * (FR-005): a document and a scalar value are not convertible into each other.
 * Takes the legacy (DB) form of both sides.
 */
export function assertTypeChangeAllowed(from: string, to: string): void {
  if (from === to) return;
  if (from === 'page_builder' || to === 'page_builder') {
    throw new HttpError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      'The value type of a Page Builder content attribute cannot be changed.',
    );
  }
}

/**
 * The ordinary attribute-values path never carries a content attribute's key
 * (FR-014, FR-042 inbound, research R-7): its value is a document authored on
 * the product content screen and stored apart from `attribute_values`. Refused
 * whether the key is new or "already stored" — a resend must not smuggle one.
 */
export function assertNoContentAttributeValues(
  attributeValues: Readonly<Record<string, unknown>> | undefined,
  views: ReadonlyArray<{ key: string; valueType: string }>,
): void {
  if (!attributeValues) return;
  const keys = Object.keys(attributeValues);
  if (keys.length === 0) return;
  const contentKeys = new Set(views.filter((view) => view.valueType === 'page_builder').map((view) => view.key));
  const refused = keys.filter((key) => contentKeys.has(key));
  if (refused.length === 0) return;
  throw new HttpError(
    400,
    ERROR_CODES.ATTRIBUTE_VALUE_REJECTED,
    `Page Builder content cannot be set through attribute values: ${refused.join(', ')}.`,
    refused.map((key) => ({
      path: `attributeValues.${key}`,
      issue: 'Page Builder content is edited on the product content screen',
    })),
  );
}
