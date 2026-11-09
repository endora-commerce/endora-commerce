import { orgScopeSql, reachesNoOrganization, type OrgConstraint } from '@endora-commerce/platform/tenancy';

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
  if (reachesNoOrganization(scope)) return null;
  // The platform's predicate for the reach (issue #305): a sales
  // representative's is every Organization nobody else governs.
  const reach = orgScopeSql('"organization_id"', scope);
  return { sql: `${select} where ${reach.sql} ${groupBy}`, params: [...reach.params] as string[] };
}
