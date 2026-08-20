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
 *
 * **`liveOnly` defaults to `false`: a by-id read returns a soft-deleted
 * address.** The two lookups differ from the two lists on purpose — an address
 * is soft-deleted, and `findById` / `findByIds` are how a caller resolves an id
 * something else already stored, where "the row is gone" and "the row was
 * deleted after it was referenced" are different answers and only the second is
 * renderable. `listForOrganization` and `findDefault` are the opposite case —
 * they are choosing an address to use *now* — so they filter `deletedAt: null`
 * unconditionally and take no flag at all.
 *
 * The consequence, said plainly because it is one careless cut from a product
 * change: a consumer replacing a hand-written `deletedAt: null` filter with
 * `findById` and dropping the filter as "now redundant" reinstates deleted
 * addresses. Pass `{ liveOnly: true }` whenever the answer feeds a choice
 * rather than a rendering — all three call sites in the tree do
 * (`orders/services/order-service.ts:989,1093,1096`). The record also carries
 * `deletedAt`, so a caller that must tell the two apart can (Phase-P
 * unreached-port audit, A8).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `addresses` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
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
 * Container name: `addressServicePort`. Owner: `addresses`.
 *
 * (It said `addressService` until issue #192, and that name **is** registered:
 * it is the `AddressService` **class**, whose methods return `Address`
 * entities. `Address` is structurally assignable to `AddressRecord`, so a
 * consumer copying the old name out of this comment gets entities across the
 * boundary behind a record-shaped type and `tsc` says nothing — the mapping
 * `createAddressServicePort` performs is exactly what it skips. Two consumers
 * followed it, `orders/backend.ts` and `organizations/backend.ts`; issue #195
 * re-pointed both at `addressServicePort` under D-98.1, which ruled the call
 * site wrong rather than this shape — every one of their six call sites reads
 * fields or `.id` off the result, so the snapshot record is all any of them
 * ever needed. The class registration stays for the module's own use.)
 *
 * The write surface `orders` and `organizations` reach. The
 * one-default-per-kind invariant and the country-code validation stay on this
 * side of the port, where they already are — `createAddress` validates the
 * country against `dictionaries` before it writes, and a caller cannot be
 * trusted to remember that.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `addresses` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
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
