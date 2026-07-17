import { MissingTenantContextError } from './tenant-context.js';

/**
 * MikroORM global-filter definitions for the tenant guard (feature 050).
 *
 * Two filters are attached to entities via the classification decorators
 * (`org-scoped.decorator.ts`) and enabled by default. Their params are stamped
 * per fork by `scoped-em.ts` from the ambient `TenantContext`. When no context
 * is present the params carry `mode: 'no-context'` and the `cond` throws
 * `MissingTenantContextError` — the fail-closed guarantee.
 */

export const ORG_FILTER = 'org';
export const CUSTOMER_FILTER = 'customerAccount';

export type FilterMode = 'single-org' | 'allowed-set' | 'all' | 'no-context';

export interface OrgFilterArgs {
  mode: FilterMode;
  organizationId?: string | null;
  allowedOrganizationIds?: readonly string[];
}

export interface CustomerFilterArgs {
  mode: FilterMode;
  customerAccountId?: string | null;
  /** For an org-admin customer who may see all of their org's accounts. */
  allowedOrganizationIds?: readonly string[];
}

/** `where` fragment applied to `@OrgScoped` entities on their `organizationId`. */
export function orgFilterCond(args: OrgFilterArgs | undefined): Record<string, unknown> {
  switch (args?.mode) {
    case 'all':
      return {};
    case 'single-org':
      return { organizationId: args.organizationId ?? null };
    case 'allowed-set':
      return { organizationId: { $in: [...(args.allowedOrganizationIds ?? [])] } };
    default:
      throw new MissingTenantContextError(`filter '${ORG_FILTER}'`);
  }
}

/** `where` fragment applied to `@CustomerScoped` entities on their `customerAccountId`. */
export function customerFilterCond(args: CustomerFilterArgs | undefined): Record<string, unknown> {
  switch (args?.mode) {
    case 'all':
      return {};
    case 'single-org':
      // A customer is confined to their own account rows.
      return { customerAccountId: args.customerAccountId ?? null };
    case 'allowed-set':
      // Org-admin visibility across their org's accounts is deferred to the
      // hierarchical-organizations feature; today an admin scope does not widen
      // customer-owned rows beyond an explicit account, so fail closed unless a
      // customer account is present.
      return args.customerAccountId
        ? { customerAccountId: args.customerAccountId }
        : { customerAccountId: null };
    default:
      throw new MissingTenantContextError(`filter '${CUSTOMER_FILTER}'`);
  }
}
