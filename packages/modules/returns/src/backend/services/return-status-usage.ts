import type { OrgConstraint } from '@endora-commerce/platform/tenancy';

/**
 * The statement behind the per-status "in use" count on the return status
 * configuration screen, confined to the organizations its reader reaches.
 *
 * `return_cases` is organization-scoped and this is an aggregate handed to the
 * connection as SQL, which the entity filter never sees — so the tenant
 * predicate is written here, from the constraint the ambient context implies
 * (`orgConstraintFor`). A reader who reaches every organization gets no
 * predicate; a reader confined to a set gets `in (…)` over it; a reader who
 * reaches none gets `null`, and no statement is run.
 */
export function returnStatusUsageQuery(
  scope: OrgConstraint,
): { sql: string; params: string[] } | null {
  const select = 'select "status_code" as status, count(*) as count from "return_cases"';
  const groupBy = 'group by "status_code"';
  if (scope.kind === 'all') return { sql: `${select} ${groupBy}`, params: [] };
  const allowed =
    scope.kind === 'single'
      ? scope.organizationId === null
        ? []
        : [scope.organizationId]
      : [...scope.organizationIds];
  if (allowed.length === 0) return null;
  return {
    sql: `${select} where "organization_id" in (${allowed.map(() => '?').join(', ')}) ${groupBy}`,
    params: allowed,
  };
}
