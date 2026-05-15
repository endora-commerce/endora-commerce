import type { AttributeScope } from '@b2b/contracts';
import type { ProductAttribute } from '../entities/product-attribute.entity.js';

/**
 * Feature 022 — scope flags for the **system** product attributes that
 * are NOT rows in `product_attributes` (and therefore do not carry
 * their own DB-stored scope flags).
 *
 * Today there are two:
 *   - `name`        — stored as a `Record<lang, string>` JSONB on
 *                     `products.name`. Pinned channel+language-scoped:
 *                     editors must be able to override Name per Sales
 *                     Channel and per Language.
 *   - `description` — same baseline shape on `products.description`;
 *                     same scope.
 *
 * Adding another system attribute is a one-line change here plus a
 * resolver consumer (admin / public / search indexer) that calls
 * `resolveAttribute` with the appropriate baseline. The reserved keys
 * MUST NOT collide with `product_attributes.key` — enforced at write
 * time by the override-service validator.
 */
export const SYSTEM_ATTRIBUTE_SCOPES: Readonly<Record<string, AttributeScope>> = {
  name: { channelScoped: true, languageScoped: true },
  description: { channelScoped: true, languageScoped: true },
};

export type SystemAttributeKey = keyof typeof SYSTEM_ATTRIBUTE_SCOPES;

export function isSystemAttributeKey(key: string): key is SystemAttributeKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_ATTRIBUTE_SCOPES, key);
}

/**
 * Resolve the effective scope of an attribute given its key and (for
 * user-defined attributes) its `ProductAttribute` row. Returns the
 * system-pinned scope when the key is reserved; falls back to the
 * row's flags otherwise; returns `{ false, false }` when neither
 * applies (caller should treat as global-only).
 */
export function getAttributeScope(
  attributeKey: string,
  productAttributeRow?: Pick<ProductAttribute, 'channelScoped' | 'languageScoped'> | null,
): AttributeScope {
  if (isSystemAttributeKey(attributeKey)) {
    // SYSTEM_ATTRIBUTE_SCOPES is keyed by SystemAttributeKey so the lookup
    // is non-undefined here, but TS' index signature still widens to
    // `T | undefined` under noUncheckedIndexedAccess.
    return SYSTEM_ATTRIBUTE_SCOPES[attributeKey]!;
  }
  if (productAttributeRow) {
    return {
      channelScoped: productAttributeRow.channelScoped,
      languageScoped: productAttributeRow.languageScoped,
    };
  }
  return { channelScoped: false, languageScoped: false };
}
