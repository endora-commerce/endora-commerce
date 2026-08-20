import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AddressKindValue,
  AddressReadPort,
  AddressRecord,
  AddressServicePort,
} from '@b2b/contracts';
import { Address } from '../entities/address.entity.js';
import type { AddressService } from './address-service.js';

/**
 * The published face of `addresses` (feature 075, Phase P).
 *
 * Ten inbound sites, six-four: `orders` and `organizations` type themselves
 * against `AddressService`, and four read the `Address` entity directly —
 * `orders` snapshotting one onto a placed order, `customers` serialising one,
 * `quick_order` resolving a buyer's default.
 *
 * Every read here is scoped by organisation. That is not defensiveness: the
 * four direct readers each already know whose address they are asking for, and
 * three of them apply the check in a second statement — which is a check that
 * can be forgotten, and in a tenancy-critical table.
 */
export class AddressReadService implements AddressReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(
    organizationId: string,
    addressId: string,
    options?: { liveOnly?: boolean },
  ): Promise<AddressRecord | null> {
    const address = await this.emFactory().findOne(Address, {
      id: addressId,
      organizationId,
      ...(options?.liveOnly ? { deletedAt: null } : {}),
    });
    return address ? toAddressRecord(address) : null;
  }

  async findByIds(
    organizationId: string,
    addressIds: readonly string[],
    options?: { liveOnly?: boolean },
  ): Promise<AddressRecord[]> {
    if (addressIds.length === 0) return [];
    const addresses = await this.emFactory().find(Address, {
      id: { $in: [...addressIds] },
      organizationId,
      ...(options?.liveOnly ? { deletedAt: null } : {}),
    });
    return addresses.map(toAddressRecord);
  }

  async listForOrganization(
    organizationId: string,
    kind?: AddressKindValue,
  ): Promise<AddressRecord[]> {
    const addresses = await this.emFactory().find(
      Address,
      { organizationId, deletedAt: null, ...(kind === undefined ? {} : { kind }) },
      { orderBy: { isDefault: 'desc', createdAt: 'asc' } },
    );
    return addresses.map(toAddressRecord);
  }

  async findDefault(
    organizationId: string,
    kind: AddressKindValue,
  ): Promise<AddressRecord | null> {
    const address = await this.emFactory().findOne(Address, {
      organizationId,
      kind,
      isDefault: true,
      deletedAt: null,
    });
    return address ? toAddressRecord(address) : null;
  }
}

/**
 * The write side, adapting `AddressService`. The service arrives as a getter
 * so the adapter resolves it per call rather than capturing this module's own
 * gated port into a singleton.
 */
export function createAddressServicePort(getService: () => AddressService): AddressServicePort {
  return {
    async list(organizationId, kind) {
      return (await getService().list(organizationId, kind)).map(toAddressRecord);
    },
    async createAddress(organizationId, input) {
      return toAddressRecord(await getService().createAddress(organizationId, input));
    },
    async updateAddress(organizationId, addressId, patch) {
      return toAddressRecord(await getService().updateAddress(organizationId, addressId, patch));
    },
    deleteAddress: (organizationId, addressId) =>
      getService().deleteAddress(organizationId, addressId),
  };
}

export function toAddressRecord(address: Address): AddressRecord {
  return {
    id: address.id,
    organizationId: address.organizationId,
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
