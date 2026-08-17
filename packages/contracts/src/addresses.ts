/**
 * `addresses` module contracts — the in-process port surface (feature 075,
 * Phase P).
 *
 * Ten inbound sites, split six-four: `orders` and `organizations` type
 * themselves against `AddressService` to create, list and delete an
 * organisation's addresses, and four read the `Address` entity directly —
 * `orders` snapshotting one onto a placed order, `customers` serialising one,
 * `quick_order` resolving a buyer's default.
 *
 * Plain TypeScript rather than Zod: these describe in-process calls. The HTTP
 * shapes are `organizations.ts`' business, because that module serves the
 * customer-facing address routes over this module's table.
 */

export type AddressKindValue = 'delivery' | 'billing';

/**
 * An address as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011).
 *
 * Every address belongs to an organisation, and there is no other kind: the
 * Organization is the one tenant concept (Principle XI), and a B2C buyer's
 * personal organisation holds theirs.
 */
export interface AddressRecord {
  id: string;
  organizationId: string;
  kind: AddressKindValue;
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateAddressInput {
  kind: AddressKindValue;
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}

export type UpdateAddressInput = Partial<{
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}>;

/**
 * Container name: `addressReadPort`. Owner: `addresses`.
 *
 * The four direct entity reads. `findById` is scoped by organisation on
 * purpose: every caller already knows whose address it is asking for, and
 * doing the check in one query is what stops it being forgotten.
 */
export interface AddressReadPort {
  findById(
    organizationId: string,
    addressId: string,
    options?: { liveOnly?: boolean },
  ): Promise<AddressRecord | null>;
  findByIds(
    organizationId: string,
    addressIds: readonly string[],
    options?: { liveOnly?: boolean },
  ): Promise<AddressRecord[]>;
  /** An organisation's addresses, optionally of one kind, default first. */
  listForOrganization(
    organizationId: string,
    kind?: AddressKindValue,
  ): Promise<AddressRecord[]>;
  /** The organisation's default address of that kind, or `null`. */
  findDefault(
    organizationId: string,
    kind: AddressKindValue,
  ): Promise<AddressRecord | null>;
}

/**
 * Container name: `addressService`. Owner: `addresses`.
 *
 * The write surface `orders` and `organizations` reach. The
 * one-default-per-kind invariant and the country-code validation stay on this
 * side of the port, where they already are — `createAddress` validates the
 * country against `dictionaries` before it writes, and a caller cannot be
 * trusted to remember that.
 */
export interface AddressServicePort {
  list(organizationId: string, kind?: AddressKindValue): Promise<AddressRecord[]>;
  createAddress(organizationId: string, input: CreateAddressInput): Promise<AddressRecord>;
  updateAddress(
    organizationId: string,
    addressId: string,
    patch: UpdateAddressInput,
  ): Promise<AddressRecord>;
  deleteAddress(organizationId: string, addressId: string): Promise<void>;
}
