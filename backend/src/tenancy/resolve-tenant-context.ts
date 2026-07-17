import type { TenantContext } from './tenant-context.js';

/**
 * Actor → TenantContext derivation (feature 050, FR-002 / data-model §1).
 *
 * The context is computed server-side from the already-authenticated actor and
 * (for scoped admins) their assignment set. It is never taken from request
 * inputs. Kept as a pure function so it is trivially unit-testable.
 */

export interface CustomerActorInput {
  readonly kind: 'customer';
  readonly customerAccountId: string;
  readonly organizationId: string | null;
  readonly impersonatorAdminUserId?: string | null;
}

export interface AdminActorInput {
  readonly kind: 'admin';
  readonly adminUserId: string;
}

export type TenantActorInput = CustomerActorInput | AdminActorInput;

/**
 * A scoped admin's reach. `allowAll: true` ⇒ platform admin (no restriction).
 * Otherwise the admin is confined to `allowedOrganizationIds`. Mirrors the
 * shape already produced by `resolveAdminOrdersScope` in composition.ts.
 */
export interface AdminScopeInput {
  readonly allowAll: boolean;
  readonly allowedOrganizationIds?: readonly string[];
}

export function resolveTenantContext(actor: TenantActorInput, adminScope?: AdminScopeInput): TenantContext {
  if (actor.kind === 'customer') {
    return {
      mode: 'single-org',
      organizationId: actor.organizationId,
      customerAccountId: actor.customerAccountId,
      actor: { kind: 'customer', id: actor.customerAccountId },
      ...(actor.impersonatorAdminUserId
        ? {
            impersonation: {
              realAdminUserId: actor.impersonatorAdminUserId,
              impersonatedCustomerAccountId: actor.customerAccountId,
            },
          }
        : {}),
    };
  }

  // Admin actor.
  if (!adminScope || adminScope.allowAll) {
    return { mode: 'all', actor: { kind: 'admin', id: actor.adminUserId } };
  }
  return {
    mode: 'allowed-set',
    allowedOrganizationIds: adminScope.allowedOrganizationIds ?? [],
    actor: { kind: 'admin', id: actor.adminUserId },
  };
}

/** Context for platform-internal work (workers, migrations, escape hatch). */
export function systemTenantContext(reason: string): TenantContext {
  return { mode: 'system', actor: { kind: 'system' }, reason };
}

/** Context pinned to a single organization (per-org jobs via the escape hatch). */
export function orgPinnedTenantContext(organizationId: string, reason: string): TenantContext {
  return {
    mode: 'single-org',
    organizationId,
    actor: { kind: 'system' },
    reason,
  };
}
