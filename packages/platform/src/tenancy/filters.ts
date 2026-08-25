import { getTenantContext, MissingTenantContextError } from './tenant-context.js';

/**
 * MikroORM global-filter definitions for the tenant guard (feature 050).
 *
 * The `cond` functions read the ambient `TenantContext` DIRECTLY from
 * AsyncLocalStorage at query time (not from `setFilterParams`). This makes the
 * filter fork-independent: it applies correctly on the request-scoped EM, on
 * `em.transactional` sub-forks, and on any other fork — because the store is
 * read when the query runs, inside the caller's async context. A query executed
 * with no ambient context throws `MissingTenantContextError` (fail-closed).
 *
 * The filters are attached (default-on, `args: false`) by the classification
 * decorators in `org-scoped.decorator.ts`.
 */

export const ORG_FILTER = 'org';
export const CUSTOMER_FILTER = 'customerAccount';

/** `where` fragment applied to `@OrgScoped` entities on their `organizationId`. */
export function orgFilterCond(): Record<string, unknown> {
  const ctx = getTenantContext();
  if (!ctx) throw new MissingTenantContextError(`filter '${ORG_FILTER}'`);
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return {};
    case 'single-org':
      // The `?? null` is belt-and-braces and **matches nothing** since D-178.
      // A `single-org` context with a null organisation was producible by
      // exactly one thing — a signed-in customer whose `customer_accounts` row
      // had `organization_id IS NULL` — and that column is `NOT NULL` now.
      // Until it was, this line put every such customer into one shared tenant
      // bucket: two of them resolved the same predicate and saw each other's
      // `@OrgScoped` rows. The type keeps the coalesce (`TenantContext`'s field
      // is optional); the platform no longer has a caller for it.
      return { organizationId: ctx.organizationId ?? null };
    case 'allowed-set':
      return { organizationId: { $in: [...(ctx.allowedOrganizationIds ?? [])] } };
  }
}

/** `where` fragment applied to `@CustomerScoped` entities on their `customerAccountId`. */
export function customerFilterCond(): Record<string, unknown> {
  const ctx = getTenantContext();
  if (!ctx) throw new MissingTenantContextError(`filter '${CUSTOMER_FILTER}'`);
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return {};
    case 'single-org':
      return { customerAccountId: ctx.customerAccountId ?? null };
    case 'allowed-set':
      // An org-scoped admin cannot be expressed as a customer-account predicate
      // (customer-scoped entities carry no org column); such rows are reached via
      // transitive scoping where needed. See research.md §R4/R7.
      return {};
  }
}
