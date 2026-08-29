import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressReadPort,
  type AddressRecord,
  type CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAddress } from '../entities/customer-address.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';

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
    /**
     * `customer_accounts`' published read model — the tenant boundary of every
     * method on this service, and not a convenience.
     *
     * `CustomerAddress` is `@CustomerScoped`, and `customerFilterCond`
     * contributes **no predicate at all** under `allowed-set`, the mode an
     * assignment-scoped administrator resolves to. This table carries no
     * organization column of its own, so nothing here can express the
     * restriction — but its owner `CustomerAccount` is `@OrgScoped`, and this
     * port reads it through a filtered EntityManager. Asking it whether the
     * account exists *is* asking whether the caller may reach that customer.
     *
     * For the buyer's own surface it is a no-op: their own account is in their
     * own scope. For a platform administrator it is a no-op too.
     */
    private readonly customerAccounts: CustomerAccountReadPort,
    private readonly auditLog?: AuditPort,
  ) {}

  /**
   * Refuse a customer the caller's organizations do not reach.
   *
   * 404 rather than 403: an out-of-scope customer must read the same as one
   * that is not there, which is what the account read already answers.
   */
  async #assertCustomerInScope(customerAccountId: string): Promise<void> {
    const account = await this.customerAccounts.findById(customerAccountId);
    if (!account) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    }
  }

  /**
   * Run a `customer_addresses` statement for the account
   * {@link CustomerAddressService.#assertCustomerInScope} has just authorised.
   *
   * Feature 087 gave `customerFilterCond` a real `allowed-set` arm, and this
   * table is one of the fifteen that carry no `organization_id` yet — so the
   * arm matches **nothing** here, which is the right floor for a guard that
   * cannot determine the allowed set and the wrong answer for a caller who has
   * already been shown to be inside it. Without this widening a sales
   * representative's own customer's address book reads as empty, and the
   * default-demotion `nativeUpdate` below silently demotes nothing, which
   * leaves two defaults.
   *
   * The widening is the sanctioned crossing (feature 050, FR-005) and not a
   * `catch`: every call is preceded, in the same method, by the
   * `customer_accounts` read that decides whether this caller may reach this
   * account at all — and `customer_accounts` is `@OrgScoped`, so that read is
   * the organization check. It is also narrow by construction: every statement
   * it covers names `customerAccountId` in its own `where`, so widening the
   * filter widens the authority by exactly nothing. It stops being needed when
   * feature 087 gives this table its own column.
   */
  #forAuthorisedCustomer<T>(customerAccountId: string, fn: () => Promise<T>): Promise<T> {
    return withSystemScope(
      `customers: personal addresses of customer account ${customerAccountId}, authorised by its own @OrgScoped account read`,
      fn,
    );
  }

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'customer_address', objectId, stateBefore, stateAfter });
    }
  }

  async listPersonal(
    customerAccountId: string,
    kind?: 'delivery' | 'billing',
  ): Promise<CustomerAddress[]> {
    await this.#assertCustomerInScope(customerAccountId);
    const em = this.emFactory();
    const where: Record<string, unknown> = { customerAccountId, deletedAt: null };
    if (kind) where.kind = kind;
    return this.#forAuthorisedCustomer(customerAccountId, () =>
      em.find(CustomerAddress, where, {
        orderBy: { isDefault: 'desc', createdAt: 'asc' },
      }),
    );
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
    await this.#assertCustomerInScope(customerAccountId);
    const em = this.emFactory();
    return em.transactional(async (txEm) => {
      if (input.isDefault) {
        await this.#forAuthorisedCustomer(customerAccountId, () =>
          txEm.nativeUpdate(
            CustomerAddress,
            { customerAccountId, kind: input.kind, isDefault: true, deletedAt: null },
            { isDefault: false },
          ),
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
    await this.#assertCustomerInScope(customerAccountId);
    const em = this.emFactory();
    return em.transactional(async (txEm) => {
      const address = await this.findOwned(txEm, customerAccountId, addressId);
      if (patch.isDefault === true && !address.isDefault) {
        await this.#forAuthorisedCustomer(customerAccountId, () =>
          txEm.nativeUpdate(
            CustomerAddress,
            { customerAccountId, kind: address.kind, isDefault: true, deletedAt: null },
            { isDefault: false },
          ),
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
    await this.#assertCustomerInScope(customerAccountId);
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
    const address = await this.#forAuthorisedCustomer(customerAccountId, () =>
      em.findOne(CustomerAddress, {
        id: addressId,
        customerAccountId,
        deletedAt: null,
      }),
    );
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
