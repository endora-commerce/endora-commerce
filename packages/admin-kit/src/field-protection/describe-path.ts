/**
 * A protection path as something an operator recognises, without opening the
 * field (feature 091, P4b).
 *
 * The five bare paths below are the grammar **both** integration contracts
 * already define, character for character, so they are the surface's rather
 * than either owner's. Everything else is rendered through the caller's
 * translator under a key the caller ships: an attribute key and a currency are
 * data, and a path outside the grammar renders verbatim rather than as a
 * missing key — a stale row is worth showing.
 *
 * A price path carries a price list identifier, which names nothing to a human.
 * When the read said which lists are live the label uses the list's name; a
 * protection on a list that no longer covers the record falls back to the
 * currency alone.
 */
import type { FieldProtectionPricePath, Translate } from './types.js';

/** The paths every provider spells identically, and the only ones this file knows. */
const SHARED_FIELD_PATHS = ['name', 'description', 'categories', 'gallery', 'attachments'];

export function describeFieldPath(
  t: Translate,
  fieldPath: string,
  livePricePaths: readonly FieldProtectionPricePath[] = [],
): string {
  if (fieldPath.startsWith('attributeValues.')) {
    return t('fieldProtection.field.attribute', {
      key: fieldPath.slice('attributeValues.'.length),
    });
  }
  if (fieldPath.startsWith('price.')) {
    const currency = fieldPath.split('.').pop() ?? '';
    const live = livePricePaths.find((entry) => entry.fieldPath === fieldPath);
    return live
      ? t('fieldProtection.field.priceInList', { list: live.priceListName, currency })
      : t('fieldProtection.field.price', { currency });
  }
  return SHARED_FIELD_PATHS.includes(fieldPath) ? t(`fieldProtection.field.${fieldPath}`) : fieldPath;
}

/**
 * A DOM id prefix for one integration's controls on one record.
 *
 * Derived from `scopeKey` and from nothing else, so two integrations on one
 * screen cannot collide: a duplicate `id` makes one `htmlFor` point at the
 * other's checkbox, which is a silently wrong control rather than a broken one.
 */
export function controlIdPrefix(scopeKey: string): string {
  return scopeKey.replace(/[^a-zA-Z0-9_-]/g, '-');
}
