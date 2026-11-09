import type { AdminScopeInput } from './resolve-tenant-context.js';
import { excludedOrganizationsPredicate, pgTextArray } from './excluded-predicate.js';
import {
  getTenantContext,
  MissingTenantContextError,
  throwIfScopeUnresolved,
  type TenantContext,
} from './tenant-context.js';

/**
 * Derived-scope helpers for entities with no direct tenant column
 * (feature 050, research.md §R7):
 *  - transitively-scoped (e.g. Invoice → Order.organizationId), and
 *  - rule-scoped (e.g. price_lists targeted via applicationRule),
 * whose admin queries must intersect the actor's org scope explicitly because the
 * automatic column filter cannot reach them.
 */

/**
 * The org restriction implied by the ambient context, as a discriminated union.
 *
 * Issue #305 replaced the one `'set'` member with two, `'allowed'` and
 * `'excluded'`, and **removed** `'set'` rather than adding beside it. The usual
 * consumer shape was `constraint.kind === 'set' ? <narrow> : <no filter>`; a new
 * member added next to `'set'` would have fallen into the "no filter" branch
 * of every such site and widened a sales representative to everything. With
 * `'set'` gone, every such comparison is a type error and none is forgotten.
 *
 * A consumer reads the constraint through the helpers below. **`excluded`'s id
 * list is a filter input the helpers own**: a consumer that reads it and gets
 * the polarity wrong confines a representative to exactly what they may not
 * see (`test/unit/tenancy/excluded-ids-stay-in-platform.test.ts`).
 */
export type OrgConstraint =
  | { readonly kind: 'all' } // platform admin / system — no restriction
  | { readonly kind: 'single'; readonly organizationId: string | null }
  | { readonly kind: 'allowed'; readonly organizationIds: readonly string[] }
  | {
      readonly kind: 'excluded';
      /** Organizations governed by another representative. Never a consumer's input. */
      readonly excludedOrganizationIds: readonly string[];
      /** The representative's own assignments: ranking and "mine" filters only. */
      readonly assignedOrganizationIds: readonly string[];
    };

/** Compute the org constraint from a context (defaults to the ambient one). */
export function orgConstraintFor(ctx: TenantContext | undefined = getTenantContext()): OrgConstraint {
  if (!ctx) throw new MissingTenantContextError('derived-scope');
  throwIfScopeUnresolved(ctx);
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return { kind: 'all' };
    case 'single-org':
      // Null since D-178 only where `TenantContext`'s optional field is unset:
      // a signed-in customer always carries an organisation, because
      // `customer_accounts.organization_id` is `NOT NULL`. See
      // `orgFilterCond`'s note in `filters.ts` — same coalesce, same reason it
      // has no reachable caller.
      return { kind: 'single', organizationId: ctx.organizationId ?? null };
    case 'allowed-set':
      return { kind: 'allowed', organizationIds: ctx.allowedOrganizationIds ?? [] };
    case 'excluded-set':
      return {
        kind: 'excluded',
        excludedOrganizationIds: ctx.excludedOrganizationIds ?? [],
        assignedOrganizationIds: ctx.assignedOrganizationIds ?? [],
      };
  }
}

/**
 * The constraint an admin scope implies, for a question about an administrator
 * **other than the one behind the request** (issue #305) — making them an
 * assignee, writing into their bell. The request's own administrator is the
 * ambient context's; this is the same mapping `resolveTenantContext` makes, so
 * the two cannot disagree about one administrator. A scope that could not be
 * resolved reaches nothing.
 */
export function orgConstraintForAdminScope(scope: AdminScopeInput): OrgConstraint {
  if (scope.unresolved !== undefined) return { kind: 'allowed', organizationIds: [] };
  if (scope.allowAll) return { kind: 'all' };
  if (scope.reach === 'excluding') {
    return {
      kind: 'excluded',
      excludedOrganizationIds: scope.excludedOrganizationIds ?? [],
      assignedOrganizationIds: scope.assignedOrganizationIds ?? [],
    };
  }
  return { kind: 'allowed', organizationIds: scope.allowedOrganizationIds ?? [] };
}

/**
 * Whether a scope reaches no organization at all, so a caller may skip a
 * statement rather than run one that matches nothing. Never a substitute for
 * the predicate: a scope that reaches some organizations still needs
 * {@link orgScopeWhere} / {@link orgScopeSql}.
 */
export function reachesNoOrganization(ctx?: OrgScopeSource): boolean {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
    case 'excluded':
      return false;
    case 'single':
      return constraint.organizationId === null;
    case 'allowed':
      return constraint.organizationIds.length === 0;
  }
}

/**
 * What every helper below accepts: a context (the ambient one by default) or a
 * constraint a caller already holds — a service that takes its scope as a
 * parameter, so the rule can be asserted without a context, passes that.
 */
export type OrgScopeSource = TenantContext | OrgConstraint | undefined;

function constraintOf(source: OrgScopeSource): OrgConstraint {
  if (source !== undefined && 'kind' in source) return source;
  return orgConstraintFor(source);
}

/**
 * Build a MikroORM `where` fragment that constrains an organization-id field to
 * the ambient scope, for transitively/rule-scoped entities and for the global
 * `Organization` itself (filtered on its primary key, issue #305). `field` is
 * the path to the org id (e.g. `'order.organizationId'` for Invoice, or
 * `'organizationId'`). Returns `{}` (no restriction) for platform-admin /
 * system scope.
 *
 * The `excluded` arm is the global filter's own predicate — one array
 * parameter, and never a null organization (`excluded-predicate.ts`).
 */
export function orgScopeWhere(field: string, ctx?: OrgScopeSource): Record<string, unknown> {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
      return {};
    case 'single':
      return { [field]: constraint.organizationId };
    case 'allowed':
      return { [field]: { $in: [...constraint.organizationIds] } };
    case 'excluded':
      return { [field]: excludedOrganizationsPredicate(constraint.excludedOrganizationIds) };
  }
}

/** A SQL predicate and its bindings, for the consumers that write SQL. */
export interface OrgScopeSql {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * The ambient scope as a SQL predicate over `columnSql` (issue #305), for the
 * consumers that read through raw SQL or the query builder rather than the
 * entity manager — catalog, analytics, search availability, customer search.
 *
 * `columnSql` is the caller's own SQL (a column reference, never input). The
 * id list travels as **one** array parameter, `?::uuid[]`, so its length never
 * meets PostgreSQL's 65 535-bind ceiling. A null organization never matches:
 * `= any(…)` and `<> all(…)` are both `NULL` for it, and the excluded arm
 * spells the null out because `<> all('{}')` is true.
 */
export function orgScopeSql(columnSql: string, ctx?: OrgScopeSource): OrgScopeSql {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
      return { sql: 'true', params: [] };
    case 'single':
      return { sql: `${columnSql} = ?`, params: [constraint.organizationId] };
    case 'allowed':
      return { sql: `${columnSql} = any(?::uuid[])`, params: [pgTextArray(constraint.organizationIds)] };
    case 'excluded':
      return {
        sql: `(${columnSql} is not null and ${columnSql} <> all(?::uuid[]))`,
        params: [pgTextArray(constraint.excludedOrganizationIds)],
      };
  }
}


/**
 * Whether the ambient scope may act on `organizationId`. Platform-admin/system
 * see all; a single-org actor only their org; an `allowed` scope only its set;
 * a sales representative (`excluded`) every organization nobody else governs.
 * Use to gate writes (inserts) that the column filter cannot reach — respond
 * indistinguishably from "not found" (FR-008) when this returns false.
 */
export function isOrgInScope(organizationId: string, ctx?: OrgScopeSource): boolean {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
      return true;
    case 'single':
      return constraint.organizationId === organizationId;
    case 'allowed':
      return constraint.organizationIds.includes(organizationId);
    case 'excluded':
      // An empty id is how callers spell "no organization" (`?? ''`), and under
      // the other arms it is simply absent from the set. Here absence would be
      // *inclusion*, so it is refused by name: a row with no organization is in
      // nobody's reach (issue #305).
      return organizationId !== '' && !constraint.excludedOrganizationIds.includes(organizationId);
  }
}

/**
 * For rule-scoped entities (price_lists): given the set of organizations a rule
 * targets, decide whether the ambient scope may see it. Platform-admin/system
 * see everything; a scoped admin sees a rule only if it targets at least one
 * organization in their reach (or targets no org at all — a channel/global
 * rule).
 */
export function ruleVisibleForScope(ruleTargetOrgIds: readonly string[], ctx?: OrgScopeSource): boolean {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
      return true;
    case 'single':
      return ruleTargetOrgIds.length === 0 || (constraint.organizationId != null && ruleTargetOrgIds.includes(constraint.organizationId));
    case 'allowed': {
      if (ruleTargetOrgIds.length === 0) return true;
      const allowed = new Set(constraint.organizationIds);
      return ruleTargetOrgIds.some((id) => allowed.has(id));
    }
    case 'excluded': {
      if (ruleTargetOrgIds.length === 0) return true;
      const excluded = new Set(constraint.excludedOrganizationIds);
      return ruleTargetOrgIds.some((id) => !excluded.has(id));
    }
  }
}

/**
 * The organizations a scoped admin is **assigned** (roll-up expanded), for
 * ranking — "assigned first" — and "mine" filters (issue #305). Empty for a
 * platform admin, a system scope and a single-org actor.
 *
 * It is never the reach: a sales representative reaches every unassigned
 * organization too. Filter through {@link orgScopeWhere} / {@link orgScopeSql}.
 */
export function assignedOrganizationIdsForRanking(ctx?: OrgScopeSource): readonly string[] {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
    case 'single':
      return [];
    case 'allowed':
      return constraint.organizationIds;
    case 'excluded':
      return constraint.assignedOrganizationIds;
  }
}
