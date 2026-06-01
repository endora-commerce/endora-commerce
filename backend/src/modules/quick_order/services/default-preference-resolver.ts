/**
 * Pure resolution of default ordering preferences (feature 039, US2 / R4).
 *
 * Most-specific-wins per field: a customer-level value overrides the
 * organization-level value; otherwise the organization value is the fallback.
 * Eligibility re-checking (active / org-allowed / address-exists) is applied
 * by the service on top of this — kept separate so the inheritance rule is
 * unit-testable without a database.
 */

export interface PreferenceRow {
  defaultPaymentMethodId: string | null;
  defaultDeliveryMethodId: string | null;
  defaultBillingAddressId: string | null;
  defaultShippingAddressId: string | null;
}

export type PreferenceFieldSource = 'customer' | 'organization' | null;

export interface ResolvedField {
  id: string | null;
  source: PreferenceFieldSource;
}

export interface ResolvedPreferenceFields {
  payment: ResolvedField;
  delivery: ResolvedField;
  billing: ResolvedField;
  shipping: ResolvedField;
}

type PreferenceField = keyof PreferenceRow;

function pick(
  field: PreferenceField,
  customerRow: PreferenceRow | null,
  orgRow: PreferenceRow | null,
): ResolvedField {
  const fromCustomer = customerRow?.[field] ?? null;
  if (fromCustomer) return { id: fromCustomer, source: 'customer' };
  const fromOrg = orgRow?.[field] ?? null;
  if (fromOrg) return { id: fromOrg, source: 'organization' };
  return { id: null, source: null };
}

export function resolvePreferenceFields(
  customerRow: PreferenceRow | null,
  orgRow: PreferenceRow | null,
): ResolvedPreferenceFields {
  return {
    payment: pick('defaultPaymentMethodId', customerRow, orgRow),
    delivery: pick('defaultDeliveryMethodId', customerRow, orgRow),
    billing: pick('defaultBillingAddressId', customerRow, orgRow),
    shipping: pick('defaultShippingAddressId', customerRow, orgRow),
  };
}
