import type { OrgConstraint } from '@endora-commerce/platform/tenancy';

/**
 * The statement behind the per-status "in use" count on the workflow screen,
 * confined to the Organizations its reader reaches.
 *
 * `crm_opportunities` is organization-scoped and this is an aggregate handed
 * to the connection as SQL, which the entity filter never sees — so the tenant
 * predicate is written here, from the constraint the ambient context implies
 * (`orgConstraintFor`). A reader who reaches every Organization gets no
 * predicate; a reader confined to a set gets `in (…)` over it; a reader who
 * reaches none gets `null`, and no statement is run.
 */
export function opportunityStatusUsageQuery(
  scope: OrgConstraint,
): { sql: string; params: string[] } | null {
  const select = 'select "status_code" as status_code, count(*) as count from "crm_opportunities"';
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
