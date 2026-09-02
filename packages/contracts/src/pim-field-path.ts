import { pimFieldPathSchema } from './pim-connector.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

function normaliseLocaleSegment(raw: string): string | null {
  const match = /^([a-z]{2})(?:_([a-z]{2}))?$/i.exec(raw);
  if (match === null) return null;
  const primary = match[1]!.toLowerCase();
  const region = match[2];
  return region === undefined ? primary : `${primary}_${region.toUpperCase()}`;
}

function normaliseUuid(raw: string): string | null {
  return UUID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

function canonicaliseAttributeBranch(segments: string[]): string | null {
  if (segments.length < 2 || segments.length > 4) return null;
  const key = segments[1]!;
  if (!ATTRIBUTE_KEY_PATTERN.test(key)) return null;

  if (segments.length === 2) {
    return `attribute.${key}`;
  }

  if (segments.length === 3) {
    const third = segments[2]!;
    const locale = normaliseLocaleSegment(third);
    if (locale !== null) {
      return `attribute.${key}.${locale}`;
    }
    const channelId = normaliseUuid(third);
    if (channelId !== null) {
      return `attribute.${key}.${channelId}`;
    }
    return null;
  }

  const channelId = normaliseUuid(segments[2]!);
  const locale = normaliseLocaleSegment(segments[3]!);
  if (channelId === null || locale === null) return null;
  return `attribute.${key}.${channelId}.${locale}`;
}

/**
 * Canonical form of a shared field-protection path, or `null` when outside the grammar.
 */
export function canonicalisePimFieldPath(raw: string): string | null {
  const value = raw.trim();
  if (value === '' || value.length > 256) return null;

  const segments = value.split('.');
  let canonical: string | null = null;

  if (segments[0] === 'attribute') {
    canonical = canonicaliseAttributeBranch(segments);
  } else if (segments[0] === 'seo' && segments.length === 3) {
    const field = segments[1]!;
    const locale = normaliseLocaleSegment(segments[2]!);
    if (
      locale !== null &&
      (field === 'metaTitle' || field === 'metaDescription' || field === 'metaKeywords')
    ) {
      canonical = `seo.${field}.${locale}`;
    }
  } else if (segments[0] === 'gallery' && segments.length === 2 && /^\d+$/.test(segments[1]!)) {
    canonical = `gallery.${segments[1]}`;
  } else if (segments[0] === 'attachment' && segments.length === 2) {
    const assetId = normaliseUuid(segments[1]!);
    if (assetId !== null) canonical = `attachment.${assetId}`;
  } else if (segments[0] === 'price' && segments.length === 3) {
    const priceListId = normaliseUuid(segments[1]!);
    const currency = segments[2]!;
    if (priceListId !== null && CURRENCY_PATTERN.test(currency)) {
      canonical = `price.${priceListId}.${currency.toUpperCase()}`;
    }
  } else if (segments[0] === 'category' && segments.length === 2) {
    const categoryId = normaliseUuid(segments[1]!);
    if (categoryId !== null) canonical = `category.${categoryId}`;
  } else if (segments[0] === 'name' || segments[0] === 'description') {
    if (segments.length === 1) {
      canonical = segments[0]!;
    } else if (segments.length === 2) {
      const locale = normaliseLocaleSegment(segments[1]!);
      if (locale !== null) canonical = `${segments[0]}.${locale}`;
    }
  }

  if (canonical === null || !pimFieldPathSchema.safeParse(canonical).success) {
    return null;
  }
  return canonical;
}

export function isValidPimFieldPath(raw: string): boolean {
  return canonicalisePimFieldPath(raw) !== null;
}
