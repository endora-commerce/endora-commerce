import type { PreferenceActor } from '@endora-commerce/contracts';
import type { QuickOrderPreferenceScope } from '@endora-commerce/contracts';

/**
 * Pure authorization for managing default ordering preferences (feature 039,
 * FR-018). The actor's identity + (for a customer-scoped target) the target
 * customer's organization are resolved by the service from the DB; this
 * function only applies the rule, so it is unit-testable.
 *
 *   - Customer        → only their own customer scope.
 *   - Org admin       → own organization scope + customers within that org.
 *   - Salesperson     → assigned organizations + customers within them.
 *   - Platform admin  → any scope.
 */
/**
 * The union moved to `@endora-commerce/contracts` in feature 075's Phase P — `customers`
 * writes a buyer's defaults through `defaultPreferencePort` and has to name
 * the actor. Re-exported here for the length of Phase P, which cuts no
 * consumer.
 */
export type { PreferenceActor };

export interface PreferenceTarget {
  scope: QuickOrderPreferenceScope;
  scopeId: string;
}

/**
 * @param targetCustomerOrganizationId for a customer-scoped target, the
 *   organization that customer belongs to (null if none). Ignored for an
 *   organization-scoped target.
 */
export function canManagePreference(
  actor: PreferenceActor,
  target: PreferenceTarget,
  targetCustomerOrganizationId: string | null,
): boolean {
  switch (actor.kind) {
    case 'platform_admin':
      return true;

    case 'customer':
      return target.scope === 'customer' && target.scopeId === actor.customerAccountId;

    case 'org_admin':
      if (target.scope === 'organization') return target.scopeId === actor.organizationId;
      return targetCustomerOrganizationId === actor.organizationId;

    case 'salesperson':
      if (target.scope === 'organization') {
        return actor.assignedOrganizationIds.includes(target.scopeId);
      }
      return (
        targetCustomerOrganizationId !== null &&
        actor.assignedOrganizationIds.includes(targetCustomerOrganizationId)
      );

    default:
      return false;
  }
}
