import { getTenantContext, MissingTenantContextError, type TenantContext } from './tenant-context.js';

/**
 * Derived-scope helpers for entities with no direct tenant column
 * (feature 050, research.md §R7):
 *  - transitively-scoped (e.g. Invoice → Order.organizationId), and
 *  - rule-scoped (e.g. price_lists targeted via applicationRule),
 * whose admin queries must intersect the actor's org scope explicitly because the
 * automatic column filter cannot reach them.
 */

/** The org restriction implied by the ambient context, as a discriminated union. */
export type OrgConstraint =
  | { readonly kind: 'all' } // platform admin / system — no restriction
  | { readonly kind: 'single'; readonly organizationId: string | null }
  | { readonly kind: 'set'; readonly organizationIds: readonly string[] };

/** Compute the org constraint from a context (defaults to the ambient one). */
export function orgConstraintFor(ctx: TenantContext | undefined = getTenantContext()): OrgConstraint {
  if (!ctx) throw new MissingTenantContextError('derived-scope');
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
      return { kind: 'set', organizationIds: ctx.allowedOrganizationIds ?? [] };
  }
}

/**
 * Build a MikroORM `where` fragment that constrains an organization-id field to
 * the ambient scope, for transitively/rule-scoped entities. `field` is the path
 * to the org id (e.g. `'order.organizationId'` for Invoice, or `'organizationId'`).
 * Returns `{}` (no restriction) for platform-admin / system scope.
 */
export function orgScopeWhere(field: string, ctx?: TenantContext): Record<string, unknown> {
  const constraint = orgConstraintFor(ctx);
  switch (constraint.kind) {
    case 'all':
      return {};
    case 'single':
      return { [field]: constraint.organizationId };
    case 'set':
      return { [field]: { $in: [...constraint.organizationIds] } };
  }
}

/**
 * Whether the ambient scope may act on `organizationId`. Platform-admin/system
 * see all; a single-org actor only their org; a scoped admin only assigned orgs.
 * Use to gate writes (inserts) that the column filter cannot reach — respond
 * indistinguishably from "not found" (FR-008) when this returns false.
 */
export function isOrgInScope(organizationId: string, ctx?: TenantContext): boolean {
  const constraint = orgConstraintFor(ctx);
  switch (constraint.kind) {
    case 'all':
      return true;
    case 'single':
      return constraint.organizationId === organizationId;
    case 'set':
      return constraint.organizationIds.includes(organizationId);
  }
}

/**
 * For rule-scoped entities (price_lists): given the set of organizations a rule
 * targets, decide whether the ambient scope may see it. Platform-admin/system
 * see everything; a scoped admin sees a rule only if it targets at least one of
 * their assigned orgs (or targets no org at all — a channel/global rule).
 */
export function ruleVisibleForScope(ruleTargetOrgIds: readonly string[], ctx?: TenantContext): boolean {
  const constraint = orgConstraintFor(ctx);
  switch (constraint.kind) {
    case 'all':
      return true;
    case 'single':
      return ruleTargetOrgIds.length === 0 || (constraint.organizationId != null && ruleTargetOrgIds.includes(constraint.organizationId));
    case 'set': {
      if (ruleTargetOrgIds.length === 0) return true;
      const allowed = new Set(constraint.organizationIds);
      return ruleTargetOrgIds.some((id) => allowed.has(id));
    }
  }
}
