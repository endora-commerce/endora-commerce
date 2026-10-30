/**
 * Owner: `pim_connector`. Canonical form of a shared field-protection path. Feature 168
 * (`specs/168-product-editor-scope-switcher/contracts/pim-locale-mapping.md` §3, FR-046): a path
 * names a whole field; the locale and channel segments of the 089 grammar are invalid, because
 * protection removes every scope of the field.
 */

import { pimFieldPathSchema } from './pim-connector.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const SEO_FIELDS = new Set(['metaTitle', 'metaDescription', 'metaKeywords']);

function normaliseUuid(raw: string): string | null {
  return UUID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

function canonicalise(segments: string[]): string | null {
  const [head, second, third] = segments;
  switch (head) {
    case 'name':
    case 'description':
      return segments.length === 1 ? head : null;
    case 'attribute':
      return segments.length === 2 && ATTRIBUTE_KEY_PATTERN.test(second!) ? `attribute.${second}` : null;
    case 'seo':
      return segments.length === 2 && SEO_FIELDS.has(second!) ? `seo.${second}` : null;
    case 'gallery':
      return segments.length === 2 && /^\d+$/.test(second!) ? `gallery.${second}` : null;
    case 'attachment':
    case 'category': {
      const id = segments.length === 2 ? normaliseUuid(second!) : null;
      return id === null ? null : `${head}.${id}`;
    }
    case 'price': {
      if (segments.length !== 3) return null;
      const priceListId = normaliseUuid(second!);
      if (priceListId === null || !CURRENCY_PATTERN.test(third!)) return null;
      return `price.${priceListId}.${third!.toUpperCase()}`;
    }
    default:
      return null;
  }
}

/** Canonical form of a shared field-protection path, or `null` when outside the grammar. */
export function canonicalisePimFieldPath(raw: string): string | null {
  const value = raw.trim();
  if (value === '' || value.length > 256) return null;
  const canonical = canonicalise(value.split('.'));
  if (canonical === null || !pimFieldPathSchema.safeParse(canonical).success) return null;
  return canonical;
}

export function isValidPimFieldPath(raw: string): boolean {
  return canonicalisePimFieldPath(raw) !== null;
}
