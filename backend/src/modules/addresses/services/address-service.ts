import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  dispatchValidatorMode,
  type DictionaryValidator,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { Address } from '../entities/address.entity.js';

/**
 * AddressService (T120).
 *
 * `setDefault` is atomic — it clears any prior `is_default=true` address of the
 * same (organization, kind), then sets the new default, inside one transaction.
 * The partial unique index on addresses prevents two defaults from coexisting
 * even under concurrent callers.
 */
export class AddressService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly dictionaryValidator?: DictionaryValidator,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'address', objectId, stateBefore, stateAfter });
    }
  }

  async list(organizationId: string, kind?: 'delivery' | 'billing'): Promise<Address[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = { organizationId, deletedAt: null };
    if (kind) where['kind'] = kind;
    return em.find(Address, where, { orderBy: { isDefault: 'desc', createdAt: 'asc' } });
  }

  async createAddress(
    organizationId: string,
    input: {
      kind: 'delivery' | 'billing';
      recipientName: string;
      street: string;
      city: string;
      postalCode: string;
      country: string;
      phone?: string;
      isDefault?: boolean;
    },
  ): Promise<Address> {
    await this.validateCountry(input.country, 'create-or-change');
    const em = this.emFactory();
    return em.transactional(async (txEm) => {
      if (input.isDefault) {
        // Demote any existing default of the same kind.
        await txEm.nativeUpdate(
          Address,
          { organizationId, kind: input.kind, isDefault: true, deletedAt: null },
          { isDefault: false },
        );
      }
      const address = txEm.create(Address, {
        organizationId,
        kind: input.kind,
        recipientName: input.recipientName,
        street: input.street,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country.toUpperCase(),
        ...(input.phone ? { phone: input.phone } : {}),
        isDefault: input.isDefault ?? false,
      });
      txEm.persist(address);
      this.#audit(txEm, 'address.create', address.id, null, { organizationId, kind: address.kind });
      await txEm.flush();
      return address;
    });
  }

  async updateAddress(
    organizationId: string,
    addressId: string,
    patch: Partial<{
      recipientName: string;
      street: string;
      city: string;
      postalCode: string;
      country: string;
      phone: string;
      isDefault: boolean;
    }>,
  ): Promise<Address> {
    const em = this.emFactory();
    return em.transactional(async (txEm) => {
      const address = await txEm.findOne(Address, { id: addressId, organizationId, deletedAt: null });
      if (!address) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Address not found.');
      }
      if (patch.isDefault === true && !address.isDefault) {
        await txEm.nativeUpdate(
          Address,
          { organizationId, kind: address.kind, isDefault: true, deletedAt: null },
          { isDefault: false },
        );
      }
      if (patch.country !== undefined) {
        await this.validateCountry(
          patch.country,
          dispatchValidatorMode(address.country, patch.country),
        );
      }
      if (patch.recipientName !== undefined) address.recipientName = patch.recipientName;
      if (patch.street !== undefined) address.street = patch.street;
      if (patch.city !== undefined) address.city = patch.city;
      if (patch.postalCode !== undefined) address.postalCode = patch.postalCode;
      if (patch.country !== undefined) address.country = patch.country.toUpperCase();
      if (patch.phone !== undefined) address.phone = patch.phone;
      if (patch.isDefault !== undefined) address.isDefault = patch.isDefault;
      this.#audit(txEm, 'address.update', address.id, null, { organizationId, kind: address.kind });
      await txEm.flush();
      return address;
    });
  }

  async deleteAddress(organizationId: string, addressId: string): Promise<void> {
    const em = this.emFactory();
    const address = await em.findOne(Address, { id: addressId, organizationId, deletedAt: null });
    if (!address) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Address not found.');
    }
    // ADDRESS_IN_USE check lives with the orders module (US2 T142) — the Order
    // entity there references addresses via snapshot, so a true "in-use" block
    // must query the Orders table. For now we soft-delete.
    address.deletedAt = new Date();
    this.#audit(em, 'address.delete', address.id, { organizationId, kind: address.kind }, null);
    await em.flush();
  }

  private async validateCountry(
    country: string,
    mode: 'create-or-change' | 'unchanged',
  ): Promise<void> {
    if (!this.dictionaryValidator) return;
    try {
      await this.dictionaryValidator.validateCountryCode(country, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw new HttpError(
          409,
          err.code,
          err.code === 'DICTIONARY_ENTRY_INACTIVE'
            ? `Country code ${err.entryCode} is no longer available for new entries.`
            : `Country code ${err.entryCode} is not recognised.`,
          [{ path: 'country', issue: err.code }],
        );
      }
      throw err;
    }
  }
}
