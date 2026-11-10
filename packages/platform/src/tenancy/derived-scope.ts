import type { AdminScopeInput } from './resolve-tenant-context.js';
import { excludedOrganizationsPredicate, excludedOrganizationsSql, pgTextArray } from './excluded-predicate.js';
import {
  getTenantContext,
  MissingTenantContextError,
  throwIfScopeUnresolved,
  type ExcludedOrganizationsQuery,
  memoiseReach,
  type ExcludedReach,
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
      /** Issue #955 — what the predicates render: the owner's SELECT of the excluded organizations. */
      readonly excludedOrganizationsQuery: ExcludedOrganizationsQuery;
      /**
       * Issue #955 Phase 2 — the excluded and assigned lists, loaded on demand
       * and memoised once per tenant context. Only the async single-id helpers
       * and the ranking await it; a rejection refuses, never widens.
       */
      readonly loadReach: () => Promise<ExcludedReach>;
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
        excludedOrganizationsQuery: requireExcludedQuery(ctx.excludedOrganizationsQuery),
        loadReach: requireReachLoader(ctx.loadExcludedReach),
      };
  }
}

/** An `excluded` constraint without its query has no predicate: refuse, never widen (issue #955). */
function requireExcludedQuery(query: ExcludedOrganizationsQuery | undefined): ExcludedOrganizationsQuery {
  if (query === undefined) {
    throw new Error('An `excluded` organization constraint must carry its excludedOrganizationsQuery (issue #955).');
  }
  return query;
}

/** An `excluded` constraint without its loader cannot answer a single-id question: refuse (issue #955). */
function requireReachLoader(load: (() => Promise<ExcludedReach>) | undefined): () => Promise<ExcludedReach> {
  if (load === undefined) {
    throw new Error('An `excluded` organization constraint must carry its loadReach (issue #955).');
  }
  return load;
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
      excludedOrganizationsQuery: requireExcludedQuery(scope.excludedOrganizationsQuery),
      loadReach: memoiseReach(requireReachLoader(scope.loadReach)),
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
      return { [field]: excludedOrganizationsPredicate(constraint.excludedOrganizationsQuery) };
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
 * allowed list travels as **one** array parameter, `?::uuid[]`, so its length
 * never meets PostgreSQL's 65 535-bind ceiling; the excluded arm is the owner's
 * uncorrelated subquery, `(col is not null and col not in (<S>))`, with its own
 * parameters (issue #955). A null organization never matches: `= any(…)` is
 * `NULL` for it, and the excluded arm spells the null out because
 * `null not in (<an empty set>)` is true.
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
      return excludedOrganizationsSql(columnSql, constraint.excludedOrganizationsQuery);
  }
}


/**
 * Whether the scope may act on `organizationId` (issue #955 Phase 2: async).
 * Platform-admin/system see all; a single-org actor only their org; an
 * `allowed` scope only its set; a sales representative (`excluded`) every
 * organization nobody else governs — read from the reach the owner loads on
 * demand, once per tenant context. Use to gate writes (inserts) that the column
 * filter cannot reach — respond indistinguishably from "not found" (FR-008)
 * when this answers false.
 *
 * **Always await it.** It replaced the synchronous `isOrgInScope`, which was
 * removed rather than retyped: `if (!isOrgInScope(x))` over a Promise is
 * always false, which would have widened every gate silently. The promise lint
 * rules (`no-floating-promises`, `no-misused-promises`) hold the call sites.
 * A loader that fails rejects, so the gate refuses.
 */
export async function orgInScope(organizationId: string, ctx?: OrgScopeSource): Promise<boolean> {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
      return true;
    case 'single':
      return constraint.organizationId === organizationId;
    case 'allowed':
      return constraint.organizationIds.includes(organizationId);
    case 'excluded': {
      // An empty id is how callers spell "no organization" (`?? ''`), and under
      // the other arms it is simply absent from the set. Here absence would be
      // *inclusion*, so it is refused by name: a row with no organization is in
      // nobody's reach (issue #305).
      if (organizationId === '') return false;
      const { excludedOrganizationIds } = await constraint.loadReach();
      return !excludedOrganizationIds.includes(organizationId);
    }
  }
}

/**
 * Issue #955 Phase 2 — the scope as a **synchronous** test, obtained once,
 * asynchronously: `const inScope = await orgScopeTest(); rows.filter((r) =>
 * inScope(r.organizationId))`. For a caller that asks the question many times
 * over rows it already holds (a page, a book's members), where awaiting
 * {@link orgInScope} per row would be noise. The returned function is a plain
 * boolean predicate, so it cannot be the Promise-in-an-`if` that the removal of
 * `isOrgInScope` closed; it answers exactly what {@link orgInScope} answers,
 * from the same memoised load. A failed load rejects here, before any row is
 * judged.
 */
export async function orgScopeTest(ctx?: OrgScopeSource): Promise<(organizationId: string) => boolean> {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
      return () => true;
    case 'single': {
      const own = constraint.organizationId;
      return (organizationId) => own === organizationId;
    }
    case 'allowed': {
      const allowed = new Set(constraint.organizationIds);
      return (organizationId) => allowed.has(organizationId);
    }
    case 'excluded': {
      const excluded = new Set((await constraint.loadReach()).excludedOrganizationIds);
      return (organizationId) => organizationId !== '' && !excluded.has(organizationId);
    }
  }
}

/**
 * For rule-scoped entities (price_lists): given the set of organizations a rule
 * targets, decide whether the scope may see it (issue #955 Phase 2: async).
 * Platform-admin/system see everything; a scoped admin sees a rule only if it
 * targets at least one organization in their reach (or targets no org at all —
 * a channel/global rule). Replaces the synchronous `ruleVisibleForScope`.
 */
export async function ruleInScope(ruleTargetOrgIds: readonly string[], ctx?: OrgScopeSource): Promise<boolean> {
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
      const excluded = new Set((await constraint.loadReach()).excludedOrganizationIds);
      return ruleTargetOrgIds.some((id) => !excluded.has(id));
    }
  }
}

/**
 * The organizations a scoped admin is **assigned** (roll-up expanded), for
 * ranking — "assigned first" — and "mine" filters (issue #305). Empty for a
 * platform admin, a system scope and a single-org actor. Async since issue
 * #955 Phase 2: a representative's list is loaded on demand.
 *
 * It is never the reach: a sales representative reaches every unassigned
 * organization too. Filter through {@link orgScopeWhere} / {@link orgScopeSql}.
 */
export async function assignedOrganizationIdsForRanking(ctx?: OrgScopeSource): Promise<readonly string[]> {
  const constraint = constraintOf(ctx);
  switch (constraint.kind) {
    case 'all':
    case 'single':
      return [];
    case 'allowed':
      return constraint.organizationIds;
    case 'excluded':
      return (await constraint.loadReach()).assignedOrganizationIds;
  }
}
