import type {
  AddressRecord,
  CustomerAddress as CustomerAddressDTO,
  OrganizationAddressRef,
} from '@b2b/contracts';
import type { CustomerAddress } from './entities/customer-address.entity.js';

/** Maps a persisted CustomerAddress to its API contract shape. */
export function serializeCustomerAddress(a: CustomerAddress): CustomerAddressDTO {
  return {
    id: a.id,
    customerAccountId: a.customerAccountId,
    kind: a.kind,
    recipientName: a.recipientName,
    street: a.street,
    city: a.city,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone ?? null,
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/**
 * Maps an org-shared address to the read-only reference shape.
 *
 * Feature 075 — the argument is `addresses`' published {@link AddressRecord},
 * not its `Address` entity: this module only ever read the columns the record
 * carries, and an entity crossing a boundary is what the port exists to stop.
 */
export function serializeOrganizationAddress(a: AddressRecord): OrganizationAddressRef {
  return {
    id: a.id,
    organizationId: a.organizationId,
    kind: a.kind,
    recipientName: a.recipientName,
    street: a.street,
    city: a.city,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone ?? null,
    isDefault: a.isDefault,
  };
}
