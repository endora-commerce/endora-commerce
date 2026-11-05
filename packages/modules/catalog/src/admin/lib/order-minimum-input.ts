import { isValidOrderMinimum } from '@endora-commerce/contracts';

export type OrderMinimumInput = { ok: true; value: number | null } | { ok: false };

/**
 * Reads a typed minimum: empty (or whitespace) means "no minimum" (`null`); otherwise an
 * integer in 1…ORDER_MINIMUM_MAX. Spaces used as thousands separators are tolerated.
 * Shared by the packaging-units editor and the product's order rules (feature 155).
 */
export function parseOrderMinimumInput(raw: string): OrderMinimumInput {
  const compact = raw.replace(/[\s  ]/g, '');
  if (compact === '') return { ok: true, value: null };
  if (!/^\d+$/.test(compact)) return { ok: false };
  const value = Number(compact);
  return isValidOrderMinimum(value) ? { ok: true, value } : { ok: false };
}
