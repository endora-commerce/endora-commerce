import type { TenantContext, TenantScopeNotices } from './tenant-context.js';

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
  /**
   * Feature 056 (US2) — roll-up widening for a customer actor. When the customer
   * holds the `organizations:rollup` capability, the server passes the actor's
   * org subtree here (`[theirOrg, ...descendants]`), and the context resolves to
   * an `allowed-set` instead of `single-org` (FR-004/FR-005). When absent/empty,
   * the customer stays `single-org` (flat behavior preserved).
   *
   * NB: there is no customer-facing capability source wired in production today
   * (admin permissions do not attach to customer accounts), so production
   * customer contexts stay `single-org`; the roll-up path for scoped actors is
   * derived at the admin scope-builder seam (`resolveAdminOrdersScope` /
   * `resolveModerationActor`) via the subtree-aware `SalesRepAssignmentService`.
   * This field keeps the derivation server-side (Principle XI) and ready for a
   * future customer-capability source.
   */
  readonly rollupSubtreeOrganizationIds?: readonly string[];
}

export interface AdminActorInput {
  readonly kind: 'admin';
  readonly adminUserId: string;
}

/**
 * Feature 062 — an api-key actor. A BOUND key (organizationId present) pins the
 * request to its organization + designated service customer account with a
 * first-class `api_key` actor for audit attribution. An UNBOUND key keeps the
 * legacy trusted system scope (its only mounted surface is the global-entity
 * PIM read/write path — research §R5).
 */
export interface ApiKeyActorInput {
  readonly kind: 'api_key';
  readonly apiKeyId: string;
  readonly organizationId?: string | null;
  readonly customerAccountId?: string | null;
}

export type TenantActorInput = CustomerActorInput | AdminActorInput | ApiKeyActorInput;

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
    // Feature 056 — a roll-up-enabled customer widens from single-org to the
    // subtree allowed-set (server-derived). Absent/empty ⇒ single-org (flat).
    if (actor.rollupSubtreeOrganizationIds && actor.rollupSubtreeOrganizationIds.length > 0) {
      return {
        mode: 'allowed-set',
        allowedOrganizationIds: [...actor.rollupSubtreeOrganizationIds],
        notices: newScopeNotices(),
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

  // Feature 062 — api-key actor: bound ⇒ single-org pinned to the binding;
  // unbound ⇒ trusted system scope (unchanged legacy behavior, FR-020).
  if (actor.kind === 'api_key') {
    if (actor.organizationId) {
      return {
        mode: 'single-org',
        organizationId: actor.organizationId,
        customerAccountId: actor.customerAccountId ?? null,
        actor: { kind: 'api_key', id: actor.apiKeyId },
      };
    }
    return systemTenantContext('actor:api_key');
  }

  // Admin actor.
  if (!adminScope || adminScope.allowAll) {
    return { mode: 'all', actor: { kind: 'admin', id: actor.adminUserId } };
  }
  return {
    mode: 'allowed-set',
    allowedOrganizationIds: adminScope.allowedOrganizationIds ?? [],
    notices: newScopeNotices(),
    actor: { kind: 'admin', id: actor.adminUserId },
  };
}

/**
 * A fresh observation sink for one execution (feature 087). Attached to the two
 * `allowed-set` branches above and to nothing else: `all` and `system` refuse
 * nothing, and `single-org` refuses per row rather than per table, so neither
 * has an emptiness to explain. One object per call, so a context can never
 * carry another request's observation — `resolveTenantContext` is called once
 * per request by the host's scope hook.
 */
function newScopeNotices(): TenantScopeNotices {
  return { organizationAttributionRefused: false };
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
