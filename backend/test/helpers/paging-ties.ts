import { expect } from 'vitest';

/**
 * Issue #1760 — shared shape of the paging-with-ties contract tests
 * (pattern: `contract/carts/admin-carts-paging-ties.contract.test.ts`).
 *
 * A test seeds {@link TIE_ROW_COUNT} rows sharing every sort key a list offers,
 * isolated either by a filter or by a sort-key value no other row holds (far in
 * the past for an ascending list, far in the future for a descending one), so
 * the tied rows are the first ones the list returns. It then pages through them
 * {@link TIE_PAGE_SIZE} at a time and holds the result to {@link expectTiesInIdOrder}.
 */
export const TIE_ROW_COUNT = 7;
export const TIE_PAGE_SIZE = 2;

/** A sort-key value no ordinary row holds that sorts before every other ascending. */
export const TIE_PAST = '1971-02-03T04:05:06.000Z';
/** A sort-key value no ordinary row holds that sorts before every other descending. */
export const TIE_FUTURE = '2999-02-03T04:05:06.000Z';

/** The ids every page answers, from `firstPage` on, for as many pages as the tied rows fill. */
export async function collectTiedPages(
  firstPage: 0 | 1,
  fetchPage: (page: number) => Promise<string[]>,
): Promise<string[]> {
  const pages = Math.ceil(TIE_ROW_COUNT / TIE_PAGE_SIZE);
  const collected: string[] = [];
  for (let page = firstPage; page < firstPage + pages; page++) collected.push(...(await fetchPage(page)));
  return collected;
}

/**
 * The tied rows came back first, each exactly once, ordered by `id` in
 * `direction`; anything after them (a page's untied tail) is not one of them.
 */
export function expectTiesInIdOrder(
  collected: readonly string[],
  seededIds: readonly string[],
  direction: 'asc' | 'desc',
): void {
  expect(new Set(collected).size, 'a row repeated across pages').toBe(collected.length);
  const expected = [...seededIds].sort();
  if (direction === 'desc') expected.reverse();
  expect(collected.slice(0, seededIds.length)).toEqual(expected);
  const seeded = new Set(seededIds);
  expect(collected.slice(seededIds.length).filter((id) => seeded.has(id))).toEqual([]);
}

/** `?, ?, ?` for an `in (...)` over `ids`. */
export function placeholders(ids: readonly unknown[]): string {
  return ids.map(() => '?').join(', ');
}
