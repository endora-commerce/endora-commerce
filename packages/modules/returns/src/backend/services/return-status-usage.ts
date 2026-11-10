import { orgScopeSql, reachesNoOrganization, type OrgConstraint } from '@endora-commerce/platform/tenancy';

/**
 * The statement behind the per-status "in use" count on the return status
 * configuration screen, confined to the organizations its reader reaches.
 *
 * `return_cases` is organization-scoped and this is an aggregate handed to the
 * connection as SQL, which the entity filter never sees — so the tenant
 * predicate is written here, from the constraint the ambient context implies
 * (`orgConstraintFor`). A reader who reaches every organization gets no
 * predicate; any other reader gets the platform's predicate for its reach
 * (`orgScopeSql`); a reader who reaches none gets `null`, and no statement is
 * run.
 */
export function returnStatusUsageQuery(
  scope: OrgConstraint,
): { sql: string; params: string[] } | null {
  const select = 'select "status_code" as status, count(*) as count from "return_cases"';
  const groupBy = 'group by "status_code"';
  if (scope.kind === 'all') return { sql: `${select} ${groupBy}`, params: [] };
  if (reachesNoOrganization(scope)) return null;
  // The platform's predicate for the reach (issue #305): a sales
  // representative's is every organization nobody else governs.
  const reach = orgScopeSql('"organization_id"', scope);
  return { sql: `${select} where ${reach.sql} ${groupBy}`, params: [...reach.params] as string[] };
}
