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
 * The codes a redacted `address` audit row keeps (issue #844).
 *
 * Owner: `addresses`; **codes only** — see `CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS`
 * for the rule they extend. The anonymisation scrub keeps an address's country,
 * so its history may keep the country code too.
 */
export const ADDRESS_AUDIT_KEEP_KEYS: readonly string[] = ['countryCode'];

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
  /**
   * The ids of the organisation's addresses, oldest first — live ones only
   * unless `includeDeleted` is `true`, which adds every soft-deleted row
   * (issue #927). Ids only: a caller that needs to name the rows an
   * anonymised subject ever had (`customers`' retention sweep, #844) asks for
   * the deleted ones too, and needs none of their content. Never another
   * organisation's rows.
   */
  listIdsForOrganization(
    organizationId: string,
    options?: { includeDeleted?: boolean },
  ): Promise<string[]>;
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
  /**
   * Clear **and** blank every address of the Organization
   * (`specs/173-b2c-address-book-merge/` OD-7): `recipientName`, `street`,
   * `city` and `postalCode` become `'-'`, `phone` `null`, `isDefault` `false`,
   * the country stays and the row is soft-deleted. **Every** row, the ones
   * already soft-deleted included (issue #927): an address the customer
   * deleted still holds their data, and it keeps its own `deletedAt`. A row
   * already fully scrubbed is not selected, so a repeat call writes nothing.
   * One `address.anonymized` audit entry per row scrubbed, with a null actor
   * and no personal data — `stateBefore` names the organisation, the kind and
   * `wasDeleted`. Answers how many rows it scrubbed.
   *
   * The retention sweep's call, for a personal Organization it has just
   * anonymized; order snapshots are copies on `orders`' rows and are untouched.
   */
  anonymizeForOrganization(organizationId: string): Promise<number>;
}
