import type { Address } from '../entities/address.entity.js';

/**
 * What an Organization address's audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`).
 *
 * An `Address` is `@OrgScoped` and the platform audit log is one global table read
 * under `audit_log:read` without Organization reach, so an address's entry carries
 * **names and structure**: its kind (a code), the sorted names of the fields that
 * changed, whether an anonymised row was already deleted, and dates. The recipient,
 * street, city, postal code and phone stay out, and so does the Organization the
 * address belongs to (the tenant anchor) — the entry is recorded against the address
 * by id.
 *
 * No screen reads an address's values back out of the audit log, so the values are
 * kept nowhere else: the address row holds the current ones.
 */

/**
 * Every top-level key an address audit state may hold. Anything else is a value until
 * somebody classifies it on purpose — `address-audit-sentinels.test.ts` holds every
 * write's recorded state to this list.
 */
export const ADDRESS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // The address's kind, a code: `delivery` or `billing`.
  'kind',
  // What changed, by name.
  'changedFields',
  // `address.anonymized`: whether the row was already deleted, and when it was blanked.
  'wasDeleted',
  'anonymizedAt',
]);

/** The fields an address write may set, in the order a reader expects them sorted. */
const ADDRESS_FIELDS = ['city', 'country', 'isDefault', 'phone', 'postalCode', 'recipientName', 'street'] as const;

type AddressField = (typeof ADDRESS_FIELDS)[number];
type AddressValues = Pick<Address, AddressField>;

/** `address.create`: the kind and the names of the fields the address was created with. */
export function addressCreatedAuditState(address: Pick<Address, 'kind' | AddressField>): Record<string, unknown> {
  return {
    kind: address.kind,
    changedFields: ADDRESS_FIELDS.filter((field) => {
      const value = address[field];
      if (field === 'isDefault') return value === true;
      return value != null && value !== '';
    }),
  };
}

/** A copy of the fields an update may change, taken before the patch is applied. */
export function addressValues(address: AddressValues): AddressValues {
  return {
    city: address.city,
    country: address.country,
    isDefault: address.isDefault,
    phone: address.phone ?? null,
    postalCode: address.postalCode,
    recipientName: address.recipientName,
    street: address.street,
  };
}

/** `address.update`: the kind and the sorted names of the fields whose value changed. */
export function addressUpdatedAuditState(before: AddressValues, after: Pick<Address, 'kind' | AddressField>): Record<string, unknown> {
  return {
    kind: after.kind,
    changedFields: ADDRESS_FIELDS.filter((field) => (before[field] ?? null) !== (after[field] ?? null)),
  };
}
