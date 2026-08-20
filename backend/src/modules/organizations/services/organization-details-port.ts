import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrganizationDetailsPort, OrganizationRecord } from '@b2b/contracts';
import { normalizeOrganizationName } from '@b2b/contracts';
import { Organization } from '../entities/organization.entity.js';

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
 */
export class OrganizationDetailsService implements OrganizationDetailsPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<OrganizationRecord | null> {
    const organization = await this.emFactory().findOne(Organization, { id });
    return organization ? toOrganizationRecord(organization) : null;
  }

  async findByIds(ids: readonly string[]): Promise<OrganizationRecord[]> {
    if (ids.length === 0) return [];
    const organizations = await this.emFactory().find(Organization, { id: { $in: [...ids] } });
    return organizations.map(toOrganizationRecord);
  }

  async countByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.emFactory().count(Organization, { id: { $in: [...ids] } });
  }

  async searchByName(query: string, limit: number): Promise<OrganizationRecord[]> {
    const organizations = await this.emFactory().find(Organization, this.#where(query), {
      orderBy: { name: 'asc' },
      limit,
    });
    return organizations.map(toOrganizationRecord);
  }

  async searchIdsByName(query: string): Promise<string[]> {
    const rows = await this.emFactory().find(Organization, this.#where(query), {
      fields: ['id'],
    });
    return rows.map((row) => row.id);
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
    taxId: organization.taxId,
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
    requiresCartApproval: organization.requiresCartApproval,
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
  };
}
