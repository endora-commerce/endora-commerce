import { raw } from '@mikro-orm/core';

/**
 * The `excluded-set` predicate on an organization column (issue #305): every
 * organization but the excluded ones, on the filtered row's own column — no
 * join, no subquery (FR-002, exit (a′)). One home for the global filters
 * (`filters.ts`) and `orgScopeWhere` (`derived-scope.ts`), so the two cannot
 * drift apart.
 *
 * ## One array parameter (issue #955)
 *
 * The list travels as **one** parameter, `<col> <> all(?::uuid[])`, under the
 * column's own key: `{ organizationId: { $ne: raw('all(?::uuid[])', [list]) } }`.
 * Spelled as MikroORM's `$nin` it was one parameter per id, and at a roll-up
 * representative's few thousand excluded organizations those were most of
 * every tenant-scoped statement of the request — four statements of 8 760
 * parameters each on the admin orders list, profiled at 220–330 ms apiece under
 * load, 34–41 ms in this form. (MikroORM inlines parameters into the statement
 * text, so "one parameter" is one array literal that the server parses once,
 * rather than thousands of quoted literals each planned as its own constant.
 * The literal is still the size of the list; see `research.md` R-5 of
 * `specs/175-sales-rep-reach-rule/`.)
 *
 * The form is property-keyed on purpose. The spike for #305 measured that a
 * `raw()` fragment used as a **key** is dropped when the same filter runs for
 * a joined `populate` (101 rows where the find answered 90) — a widening. A
 * raw **value** under the property survives: the spike for #955 matched `$nin`
 * row for row over `find`, `count`, `findAndCount`, `findByCursor`, a joined
 * and a select-in `populate`, `Collection.init`, a fork, a transaction,
 * `nativeUpdate` / `nativeDelete`, a filter merged with a `where` naming the
 * same column, and 70 000 ids, and left MikroORM's raw-fragment cache empty.
 * (`$nin: raw('select unnest(…)')`, the other candidate, renders as
 * `not in select …` in the joined populate and fails to parse.)
 *
 * ## Never a null organization
 *
 * `null <> all(<a non-empty list>)` is `NULL`, so a row with no organization
 * never matches. An **empty** list is the exception — `<> all('{}')` is true for
 * every row, null included — so it is spelled `{ $ne: null }`: a representative
 * on a platform where nobody else holds an assignment still reads no row that
 * belongs to no organization (Principle XI's "no-organization path").
 */
export function excludedOrganizationsPredicate(excluded: readonly string[]): Record<string, unknown> {
  return excluded.length === 0 ? { $ne: null } : { $ne: raw('all(?::uuid[])', [pgTextArray(excluded)]) };
}

/** A PostgreSQL array literal, every element quoted, for one bind parameter. */
export function pgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`).join(',')}}`;
}
