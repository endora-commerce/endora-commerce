import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAddressReadPort, CustomerAddressRecord } from '@b2b/contracts';
import { CustomerAddress } from '../entities/customer-address.entity.js';

/**
 * The customer-address read model `customers` publishes (feature 075, Phase P).
 *
 * One consumer: `quick_order` resolves a buyer's saved personal address when
 * it fills in their one-click defaults.
 *
 * The table is distinct from `addresses`' on purpose and the port keeps them
 * distinct: this one hangs off a **customer account**, that one off an
 * **organisation**. A B2C buyer keeps addresses that are theirs rather than
 * their personal organisation's, and a merged shape would hide which of the
 * two a caller is holding.
 *
 * `findById` is scoped by customer account for the reason its organisation
 * twin gives: the caller already knows whose address it wants, and one query
 * is what stops the ownership check being forgotten.
 */
export class CustomerAddressReadService implements CustomerAddressReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(
    customerAccountId: string,
    addressId: string,
    options?: { liveOnly?: boolean },
  ): Promise<CustomerAddressRecord | null> {
    const address = await this.emFactory().findOne(CustomerAddress, {
      id: addressId,
      customerAccountId,
      ...(options?.liveOnly ? { deletedAt: null } : {}),
    });
    return address ? toCustomerAddressRecord(address) : null;
  }

  async listForCustomer(
    customerAccountId: string,
    kind?: 'delivery' | 'billing',
  ): Promise<CustomerAddressRecord[]> {
    const addresses = await this.emFactory().find(
      CustomerAddress,
      { customerAccountId, deletedAt: null, ...(kind === undefined ? {} : { kind }) },
      { orderBy: { isDefault: 'desc', createdAt: 'asc' } },
    );
    return addresses.map(toCustomerAddressRecord);
  }
}

export function toCustomerAddressRecord(address: CustomerAddress): CustomerAddressRecord {
  return {
    id: address.id,
    customerAccountId: address.customerAccountId,
    kind: address.kind,
    recipientName: address.recipientName,
    street: address.street,
    city: address.city,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone ?? null,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
    deletedAt: address.deletedAt ?? null,
  };
}
