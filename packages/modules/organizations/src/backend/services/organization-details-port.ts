import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  EntityExtensionReadOptions,
  OrganizationDetailsPort,
  OrganizationRecord,
  TaxIdResolution,
  WithEntityExtensions,
} from '@endora-commerce/contracts';
import { normalizeOrganizationName } from '@endora-commerce/contracts';
import { lazyEntityExtensionReads, type EntityExtensionReads } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import { TaxIdLookupService } from './tax-id-lookup-service.js';

/**
 * The row-level read model `organizations` publishes (feature 075, Phase P).
 *
 * Eleven modules read this table; 24 of the 47 inbound import sites are a
 * direct `em.findOne` / `em.find` on the entity class, spread across carts,
 * orders, pricing, quotes, push messages and two admin pickers. This service
 * is the union of what they ask for, and the mapping into
 * `OrganizationRecord` is what keeps the entity on this side of the boundary.
 *
 * It is a **second** port beside the kernel's `organizationReadPort`, not a
 * replacement: that one is the tenancy projection (`{ id, status }` plus
 * `assertCanTransact`), and D-55 settled it at that. See the contract's note.
 *
 * One behaviour deliberately changes as callers move onto it. Two of the three
 * name pickers query `name` with `$ilike`, so a search for "lodz" misses
 * "Łódź"; `searchByName` queries the diacritic-folded `nameSearch` column that
 * exists for precisely this, as `orders`' list filter already does.
 *
 * `findByTaxId` / `resolveByTaxId` (`specs/177-tax-id-scope/`, FR-023) are
 * {@link TaxIdLookupService}'s, published here — beside `findById` — because they
 * are reads (owner ruling D-290, OD-1).
 *
 * `findById`, `findByIds`, `searchByName` and `findByTaxId` take
 * `options.include` (`specs/187-side-table-extensions/` FR-058): the records
 * they found, on the entity manager that found them, are handed to the
 * platform's `entityExtensionReads`, which attaches the named modules'
 * side-table values. Without `include` nothing is resolved or loaded.
 */
const HOST = 'organizations.Organization';

export class OrganizationDetailsService implements OrganizationDetailsPort {
  readonly #lookups: TaxIdLookupService;

  constructor(
    private readonly emFactory: () => EntityManager,
    /** The kernel's `entityExtensionReads`; absent in a hand-built service, which has no loader to offer. */
    private readonly extensionReads: EntityExtensionReads = lazyEntityExtensionReads(() => undefined),
  ) {
    this.#lookups = new TaxIdLookupService(emFactory);
  }

  async findById(
    id: string,
    options?: EntityExtensionReadOptions,
  ): Promise<WithEntityExtensions<OrganizationRecord> | null> {
    const em = this.emFactory();
    const organization = await em.findOne(Organization, { id });
    if (!organization) return null;
    const [record] = await this.#attach([toOrganizationRecord(organization)], options, em);
    return record ?? null;
  }

  async findByIds(
    ids: readonly string[],
    options?: EntityExtensionReadOptions,
  ): Promise<WithEntityExtensions<OrganizationRecord>[]> {
    if (ids.length === 0) return [];
    const em = this.emFactory();
    const organizations = await em.find(Organization, { id: { $in: [...ids] } });
    return this.#attach(organizations.map(toOrganizationRecord), options, em);
  }

  async countByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.emFactory().count(Organization, { id: { $in: [...ids] } });
  }

  async searchByName(
    query: string,
    limit: number,
    options?: EntityExtensionReadOptions,
  ): Promise<WithEntityExtensions<OrganizationRecord>[]> {
    const em = this.emFactory();
    const organizations = await em.find(Organization, this.#where(query), {
      orderBy: { name: 'asc' },
      limit,
    });
    return this.#attach(organizations.map(toOrganizationRecord), options, em);
  }

  async searchIdsByName(query: string): Promise<string[]> {
    const rows = await this.emFactory().find(Organization, this.#where(query), {
      fields: ['id'],
    });
    return rows.map((row) => row.id);
  }

  async findByTaxId(
    taxId: string,
    options: { includeDeleted?: boolean } & EntityExtensionReadOptions = {},
  ): Promise<WithEntityExtensions<OrganizationRecord>[]> {
    const em = this.emFactory();
    const found = await this.#lookups.findByTaxId(taxId, {
      ...(options.includeDeleted === undefined ? {} : { includeDeleted: options.includeDeleted }),
      em,
    });
    return this.#attach(found.map(toOrganizationRecord), options, em);
  }

  async resolveByTaxId(taxId: string): Promise<TaxIdResolution> {
    const resolution = await this.#lookups.resolveByTaxId(taxId);
    switch (resolution.kind) {
      case 'none':
        return resolution;
      case 'one':
        return { kind: 'one', organization: toOrganizationRecord(resolution.organization) };
      case 'ambiguous':
        return { kind: 'ambiguous', organizations: resolution.organizations.map(toOrganizationRecord) };
    }
  }

  async #attach(
    records: OrganizationRecord[],
    options: EntityExtensionReadOptions | undefined,
    em: EntityManager,
  ): Promise<WithEntityExtensions<OrganizationRecord>[]> {
    return [...(await this.extensionReads.attach(HOST, records, options, em))];
  }

  #where(query: string): Record<string, unknown> {
    const trimmed = query.trim();
    if (!trimmed) return {};
    return { nameSearch: { $like: `%${normalizeOrganizationName(trimmed)}%` } };
  }
}

export function toOrganizationRecord(organization: Organization): OrganizationRecord {
  return {
    id: organization.id,
    name: organization.name,
    legalName: organization.legalName ?? null,
    taxId: organization.taxId ?? null,
    status: organization.status,
    vatStatus: organization.vatStatus,
    isPersonal: organization.isPersonal,
    customerGroupId: organization.customerGroupId ?? null,
    registeredAddress: organization.registeredAddress,
    orderConfirmationEmails: organization.orderConfirmationEmails ?? [],
    vatValidatedAt: organization.vatValidatedAt ?? null,
    vatValidationProvider: organization.vatValidationProvider ?? null,
    vatValidationOutcome: organization.vatValidationOutcome ?? null,
    blockedReason: organization.blockedReason ?? null,
    blockedAt: organization.blockedAt ?? null,
    rejectedReason: organization.rejectedReason ?? null,
    rejectedAt: organization.rejectedAt ?? null,
    approvedAt: organization.approvedAt ?? null,
    approvedByAdminUserId: organization.approvedByAdminUserId ?? null,
    fulfilmentStrategy: organization.fulfilmentStrategy ?? null,
    fulfilmentStrategyWarehouseOrder: organization.fulfilmentStrategyWarehouseOrder ?? null,
    parentId: organization.parentId ?? null,
    path: organization.path,
    creditInheritanceMode: organization.creditInheritanceMode ?? null,
    customFieldValues: organization.customFieldValues ?? {},
    version: organization.version,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    deletedAt: organization.deletedAt ?? null,
    convertedToCompanyAt: organization.convertedToCompanyAt ?? null,
  };
}
