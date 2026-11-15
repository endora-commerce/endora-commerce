import type { QuickOrderPreference } from '@endora-commerce/contracts';

/**
 * What a `quick_order.default_preference.update` audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md` §5).
 *
 * The preference row is `@GlobalEntity`, but each one is about a tenant-scoped record —
 * an Organization or a customer account, named by `scopeId` — and the platform audit log
 * is one global table read under `audit_log:read` without Organization reach. So the
 * entry carries the scope (a code), the ids of the chosen payment and delivery methods
 * and addresses (opaque references) and, after the write, the sorted names of the fields
 * that changed. The `scopeId` (the tenant anchor) stays out: the entry is recorded
 * against the preference row by id.
 *
 * No screen reads these values back out of the audit log, so there is no value store.
 */

/**
 * Every top-level key a default-preference audit state may hold. Anything else is a value
 * until somebody classifies it on purpose — `default-preference-audit-sentinels.test.ts`
 * holds every write's recorded state to this list.
 */
export const QUICK_ORDER_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Whose defaults these are, as a code: `organization` or `customer`.
  'scope',
  // The chosen defaults, by id.
  'defaultPaymentMethodId',
  'defaultDeliveryMethodId',
  'defaultBillingAddressId',
  'defaultShippingAddressId',
  // What changed, by name.
  'changedFields',
]);

const PREFERENCE_FIELDS = [
  'defaultBillingAddressId',
  'defaultDeliveryMethodId',
  'defaultPaymentMethodId',
  'defaultShippingAddressId',
] as const;

/** A preference's audit state: the scope and the chosen ids, never the `scopeId`. */
export function preferenceAuditState(preference: QuickOrderPreference): Record<string, unknown> {
  return {
    scope: preference.scope,
    defaultPaymentMethodId: preference.defaultPaymentMethodId,
    defaultDeliveryMethodId: preference.defaultDeliveryMethodId,
    defaultBillingAddressId: preference.defaultBillingAddressId,
    defaultShippingAddressId: preference.defaultShippingAddressId,
  };
}

/** The `stateAfter` of a write: the state, plus the sorted names of the fields that changed. */
export function preferenceUpdatedAuditState(
  before: QuickOrderPreference | null,
  after: QuickOrderPreference,
): Record<string, unknown> {
  return {
    ...preferenceAuditState(after),
    changedFields: PREFERENCE_FIELDS.filter((field) => (before?.[field] ?? null) !== (after[field] ?? null)),
  };
}
