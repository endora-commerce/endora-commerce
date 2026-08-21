import { productListSortSchema, type ProductListSort } from '@b2b/contracts';

/**
 * The listing chrome's two feature-086 query parameters, parsed once for both
 * catalogue pages (feature 086 / FR-023).
 *
 * Extracted rather than written twice because the two pages already had two
 * copies of the sort parser and they had already drifted in shape; a third
 * pair, over a control whose whole point is that it agrees with the API, is a
 * drift waiting to be a wrong ordering on one route and not the other.
 *
 * A malformed or negative bound is **dropped**, matching what the API's own
 * hand-parsed surface does with every other malformed parameter. A minimum
 * above a maximum is *not* dropped: it is forwarded, so the API answers
 * `PRICE_RANGE_INVALID` and the buyer is told which two bounds they typed the
 * wrong way round rather than being shown an empty page (FR-008).
 */
export interface CatalogPriceQuery {
  sort?: ProductListSort | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
}

export function parseSortParam(raw: unknown): ProductListSort | undefined {
  const parsed = productListSortSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function parsePriceBound(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseCatalogPriceQuery(
  raw: Record<string, string | string[] | undefined>,
): CatalogPriceQuery {
  const sort = parseSortParam(raw['sort']);
  const minPrice = parsePriceBound(raw['minPrice']);
  const maxPrice = parsePriceBound(raw['maxPrice']);
  return {
    ...(sort !== undefined ? { sort } : {}),
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
  };
}

/** Is a price control in use on this request? Decides FR-024's note. */
export function priceControlsActive(query: CatalogPriceQuery): boolean {
  return (
    query.sort === 'price' ||
    query.sort === '-price' ||
    query.minPrice !== undefined ||
    query.maxPrice !== undefined
  );
}
