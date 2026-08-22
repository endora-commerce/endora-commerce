import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type AddressReadPort, type AddressRecord } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAddress } from '../entities/customer-address.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';

/**
 * CustomerAddressService — the personal address book (feature 040, US2).
 *
 * Clones the org `AddressService` default-demotion pattern (transactional +
 * partial unique index) but keyed by `customerAccountId`. For org-bound
 * customers the read endpoints also surface the Organization's shared
 * addresses (read-only) so they can be selected (FR-038).
 */
export interface CustomerAddressInputView {
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | undefined;
  isDefault?: boolean | undefined;
}

/** Mutable fields on update — `kind` is immutable once created. */
export interface CustomerAddressPatch {
  recipientName?: string | undefined;
  street?: string | undefined;
  city?: string | undefined;
  postalCode?: string | undefined;
  country?: string | undefined;
  phone?: string | undefined;
  isDefault?: boolean | undefined;
}

export class CustomerAddressService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 075 — `addresses`' published read port, where this service used
     * to run `em.find(Address, …)` over that module's table. The org-shared
     * list is the only thing it ever asked for, and the port already scopes
     * every read by organisation.
     */
    private readonly organizationAddresses: AddressReadPort,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'customer_address', objectId, stateBefore, stateAfter });
    }
  }

  async listPersonal(
    customerAccountId: string,
    kind?: 'delivery' | 'billing',
  ): Promise<CustomerAddress[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = { customerAccountId, deletedAt: null };
    if (kind) where.kind = kind;
    return em.find(CustomerAddress, where, {
      orderBy: { isDefault: 'desc', createdAt: 'asc' },
    });
  }

  /** Org-shared addresses, read-only, for org-bound customers (FR-038). */
  async listOrganizationAddresses(
    organizationId: string,
    kind?: 'delivery' | 'billing',
  ): Promise<AddressRecord[]> {
    return this.organizationAddresses.listForOrganization(organizationId, kind);
  }

  async create(
    customerAccountId: string,
    input: CustomerAddressInputView,
  ): Promise<CustomerAddress> {
    const em = this.emFactory();
    return em.transactional(async (txEm) => {
      if (input.isDefault) {
        await txEm.nativeUpdate(
          CustomerAddress,
          { customerAccountId, kind: input.kind, isDefault: true, deletedAt: null },
          { isDefault: false },
        );
      }
      const address = txEm.create(CustomerAddress, {
        customerAccountId,
        kind: input.kind,
        recipientName: input.recipientName,
        street: input.street,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
        phone: input.phone ?? null,
        isDefault: input.isDefault ?? false,
      });
      txEm.persist(address);
      this.#audit(txEm, 'customer_address.create', address.id, null, { customerAccountId, kind: address.kind });
      await txEm.flush();
      return address;
    });
  }

  async update(
    customerAccountId: string,
    addressId: string,
    patch: CustomerAddressPatch,
  ): Promise<CustomerAddress> {
    const em = this.emFactory();
    return em.transactional(async (txEm) => {
      const address = await this.findOwned(txEm, customerAccountId, addressId);
      if (patch.isDefault === true && !address.isDefault) {
        await txEm.nativeUpdate(
          CustomerAddress,
          { customerAccountId, kind: address.kind, isDefault: true, deletedAt: null },
          { isDefault: false },
        );
      }
      if (patch.recipientName !== undefined) address.recipientName = patch.recipientName;
      if (patch.street !== undefined) address.street = patch.street;
      if (patch.city !== undefined) address.city = patch.city;
      if (patch.postalCode !== undefined) address.postalCode = patch.postalCode;
      if (patch.country !== undefined) address.country = patch.country;
      if (patch.phone !== undefined) address.phone = patch.phone ?? null;
      if (patch.isDefault !== undefined) address.isDefault = patch.isDefault;
      this.#audit(txEm, 'customer_address.update', address.id, null, { customerAccountId, kind: address.kind });
      await txEm.persistAndFlush(address);
      return address;
    });
  }

  /** Marks the address the default for its kind (demoting the previous one). */
  async setDefault(
    customerAccountId: string,
    addressId: string,
  ): Promise<CustomerAddress> {
    return this.update(customerAccountId, addressId, { isDefault: true });
  }

  async delete(customerAccountId: string, addressId: string): Promise<void> {
    const em = this.emFactory();
    await em.transactional(async (txEm) => {
      const address = await this.findOwned(txEm, customerAccountId, addressId);
      address.deletedAt = new Date();
      // Deleting a default leaves no default of that kind (FR-009 graceful
      // degrade); the storefront prompts re-selection.
      address.isDefault = false;
      this.#audit(txEm, 'customer_address.delete', address.id, { customerAccountId, kind: address.kind }, null);
      await txEm.persistAndFlush(address);
    });
  }

  private async findOwned(
    em: EntityManager,
    customerAccountId: string,
    addressId: string,
  ): Promise<CustomerAddress> {
    const address = await em.findOne(CustomerAddress, {
      id: addressId,
      customerAccountId,
      deletedAt: null,
    });
    if (!address) {
      throw new HttpError(
        404,
        ERROR_CODES.CUSTOMER_ADDRESS_NOT_FOUND,
        'Address not found.',
      );
    }
    return address;
  }
}
