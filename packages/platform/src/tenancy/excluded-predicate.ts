import { knex } from '@mikro-orm/postgresql';
import type { ExcludedOrganizationsQuery } from './tenant-context.js';

/**
 * The `excluded-set` predicate on an organization column (issues #305, #955):
 * every organization but the excluded ones, on the filtered row's own column.
 * One home for the global filters (`filters.ts`), `orgScopeWhere` and
 * `orgScopeSql` (`derived-scope.ts`), so they cannot drift apart.
 *
 * ## An uncorrelated subquery, owned by the module that owns the reach
 *
 * `col is not null and col not in (<S>)`, where S is the
 * `excludedOrganizationsQuery` the owner (`organizations`) answered on
 * `adminTenantScopePort` — an uncorrelated SELECT of one uuid column, read live
 * in each statement's snapshot. The platform renders S and never names what it
 * reads (Principle I; a static pin holds it).
 *
 * This revises FR-002 / exit (a′)'s letter — "no join, no subquery" — narrowly,
 * by the architect's ruling on #955 (2026-11-09): an **uncorrelated** subquery
 * that yields organization ids, compared against the row's **own** column, is
 * allowed; a correlated subquery and a join stay forbidden. Until then the
 * excluded list itself travelled into every statement — first as one parameter
 * per id (`$nin`), then as one array literal — and MikroORM formats every
 * parameter into the statement text, so each tenant-scoped statement carried a
 * literal the size of the list (~160 KB, ~5–10 ms a statement at 4 380 ids;
 * `specs/175-sales-rep-reach-rule/research.md` R-5). S costs a hashed SubPlan.
 *
 * ## The spelling: `$nin` with a query-builder subquery, under the property
 *
 * `{ [field]: { $ne: null, $nin: <knex query builder> } }`. It must be
 * `NOT IN` — the ANY-sublink form, the one PostgreSQL hashes; `<> all(S)` never
 * is. It must be property-keyed: a `raw()` **key** is dropped when the filter
 * runs for a joined `populate` (R-1), and `$nin: raw('select …')` renders as
 * `not in select …` there, a syntax error (R-5). The spike for #955 matched the
 * one-id rule row for row over `find`, `count`, `findAndCount`,
 * `findByCursor`, a joined and a select-in `populate`, `Collection.init`, a
 * fork, a transaction, `nativeUpdate` / `nativeDelete`, a filter merged with a
 * `where` on the same column, an empty S and a null organization, with
 * MikroORM's raw-fragment cache left empty
 * (`test/integration/organizations/reach-governor-maintenance.test.ts`).
 *
 * The builder comes from a connection-less knex instance: it is only ever
 * compiled into the outer statement, so it needs the PostgreSQL dialect and
 * nothing else — and `orgScopeWhere` stays a pure function of the scope.
 *
 * ## Never a null organization
 *
 * `null not in (<an empty set>)` is **true**, so `is not null` is spelled out:
 * a representative from whom nothing is excluded still reads no row that
 * belongs to no organization (Principle XI's "no-organization path").
 */
const dialect = knex({ client: 'pg' });

/** The alias S is wrapped under, so any uncorrelated SELECT is a valid derived table. */
const SUBQUERY_ALIAS = 'reach_excluded';

export function excludedOrganizationsPredicate(query: ExcludedOrganizationsQuery): Record<string, unknown> {
  const subquery = dialect
    .select('*')
    .fromRaw(dialect.raw(`(${query.sql}) as "${SUBQUERY_ALIAS}"`, [...query.params]));
  return { $ne: null, $nin: subquery };
}

/** The same predicate for raw SQL: knex binds `query.params` beside the caller's own. */
export function excludedOrganizationsSql(
  columnSql: string,
  query: ExcludedOrganizationsQuery,
): { readonly sql: string; readonly params: readonly unknown[] } {
  return {
    sql: `(${columnSql} is not null and ${columnSql} not in (${query.sql}))`,
    params: [...query.params],
  };
}

/** A PostgreSQL array literal, every element quoted, for one bind parameter. */
export function pgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`).join(',')}}`;
}
