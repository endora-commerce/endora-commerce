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
 * Refuse every locked capability switched on (FR-003, FR-040).
 *
 * On create the request names the type itself, so the rule judges the request
 * alone: `400 VALIDATION_FAILED`, one `details` entry per offending field. On
 * update the caller passes the stored attribute — its stored type is what
 * refuses the flag — and the refusal is `400 CONTENT_ATTRIBUTE_CAPABILITY_LOCKED`
 * with the flags joined in `details.capabilities` (issue #1218, #86; the same
 * split #624 made for the slider).
 */
export function assertContentAttributeShape(
  flags: ContentAttributeFlags,
  stored?: { readonly attributeKey: string },
): void {
  const refused = CONTENT_ATTRIBUTE_LOCKED_FLAGS.filter((flag) => flags[flag] === true);
  if (refused.length === 0) return;
  const message = `Page Builder content attributes cannot have: ${refused.join(', ')}.`;
  if (stored) {
    throw new HttpError(400, ERROR_CODES.CONTENT_ATTRIBUTE_CAPABILITY_LOCKED, message, {
      attributeKey: stored.attributeKey,
      capabilities: refused.join(', '),
    });
  }
  throw new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    message,
    refused.map((flag) => ({ path: flag, issue: ISSUE })),
  );
}

/**
 * The value type of an attribute never moves to or from `page_builder`
 * (FR-005): a document and a scalar value are not convertible into each other.
 * Takes the legacy (DB) form of both sides.
 *
 * Issue #1218 (#86) — the stored type refuses a well-formed request, so the
 * refusal is the value-type lock's code with the token `page_builder`, whose
 * sentence names the attribute.
 */
export function assertTypeChangeAllowed(from: string, to: string, attributeKey: string): void {
  if (from === to) return;
  if (from === 'page_builder' || to === 'page_builder') {
    throw new HttpError(
      409,
      ERROR_CODES.ATTRIBUTE_VALUE_TYPE_LOCKED,
      'The value type of a Page Builder content attribute cannot be changed.',
      { code: 'page_builder', attributeKey },
    );
  }
}

/**
 * The ordinary attribute-values path never carries a content attribute's key
 * (FR-014, FR-042 inbound, research R-7): its value is a document authored on
 * the product content screen and stored apart from `attribute_values`. Refused
 * whether the key is new or "already stored" — a resend must not smuggle one.
 *
 * The attribute usually *is* in the product's set, so the code's own sentence
 * ("do not belong to this product's attribute set") would be false: the token
 * `page_builder_content` chooses one that says why, naming the keys joined in
 * `details.attributeKeys` (issue #1223; the array details could carry neither).
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
    { code: 'page_builder_content', attributeKeys: refused.join(', ') },
  );
}
