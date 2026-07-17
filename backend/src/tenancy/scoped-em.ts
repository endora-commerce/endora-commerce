import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { getTenantContext, type TenantContext } from './tenant-context.js';
import {
  ORG_FILTER,
  CUSTOMER_FILTER,
  type OrgFilterArgs,
  type CustomerFilterArgs,
} from './filters.js';

/**
 * The single EM-injection seam (feature 050). Replaces the bare `orm.em.fork()`
 * used across composition.ts. Each fork reads the ambient `TenantContext` and
 * stamps the `org` + `customerAccount` filter params, so:
 *  - a query on a classified entity is automatically confined to the tenant, and
 *  - a query with NO ambient context carries `mode: 'no-context'`, making the
 *    filter `cond` throw (fail-closed).
 *
 * Setting params for a filter that no entity declares is a harmless no-op, so
 * during the phased rollout (before any entity is classified) `forkScopedEm`
 * behaves exactly like `orm.em.fork()`.
 */

export function orgFilterArgsFor(ctx: TenantContext | undefined): OrgFilterArgs {
  if (!ctx) return { mode: 'no-context' };
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return { mode: 'all' };
    case 'single-org':
      return { mode: 'single-org', organizationId: ctx.organizationId ?? null };
    case 'allowed-set':
      return { mode: 'allowed-set', allowedOrganizationIds: ctx.allowedOrganizationIds ?? [] };
  }
}

export function customerFilterArgsFor(ctx: TenantContext | undefined): CustomerFilterArgs {
  if (!ctx) return { mode: 'no-context' };
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return { mode: 'all' };
    case 'single-org':
      return { mode: 'single-org', customerAccountId: ctx.customerAccountId ?? null };
    case 'allowed-set':
      // An org-scoped admin cannot be expressed as a customer-account predicate
      // (customer-scoped entities carry no org column). Such rows are reached
      // via transitive scoping where needed; the customerAccount filter does not
      // constrain them for admins. See research.md §R4/R7.
      return { mode: 'all' };
  }
}

/** Fork a fresh EntityManager with tenant filter params stamped from ambient context. */
export function forkScopedEm(orm: MikroORM): EntityManager {
  const em = orm.em.fork() as EntityManager;
  const ctx = getTenantContext();
  em.setFilterParams(ORG_FILTER, orgFilterArgsFor(ctx));
  em.setFilterParams(CUSTOMER_FILTER, customerFilterArgsFor(ctx));
  return em;
}
