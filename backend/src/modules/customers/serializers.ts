import type { CustomerAddress as CustomerAddressDTO, OrganizationAddressRef } from '@b2b/contracts';
import type { CustomerAddress } from './entities/customer-address.entity.js';
import type { Address } from '../addresses/entities/address.entity.js';

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

/** Maps an org-shared Address to the read-only reference shape. */
export function serializeOrganizationAddress(a: Address): OrganizationAddressRef {
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
