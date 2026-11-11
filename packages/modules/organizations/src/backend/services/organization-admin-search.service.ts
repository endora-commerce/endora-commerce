import { QueryOrder, raw, type FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeOrganizationName, normalizeTaxId } from '@endora-commerce/contracts';
import { orgScopeWhere } from '@endora-commerce/platform/tenancy';
import { Organization } from '../entities/organization.entity.js';
import type { OrganizationAdminSearchQuery, OrganizationAdminSearchRow } from '../admin-search-provider.js';

/** `\`, `%` and `_` matched literally (Postgres' default LIKE escape is `\`). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Global search over organizations (`specs/150-admin-global-search/`, T040).
 *
 * **The rows are the Organizations list's** — business organizations
 * (`is_personal = false`) that are not deleted, narrowed to the searching
 * admin's reach exactly as the list is (FR-015, issue #305): for a sales
 * representative, every organization not governed by another representative.
 * That replaced the owner's answer to spec Q2 ("every organization, for anyone
 * who may read the list") on 2026-11-07. The assignments only **order** the
 * result: `assignedOrganizationIds` rank before every other organization, and
 * within each group the usual ranking applies — tax ID exact → prefix → rest,
 * then most recent change, then id, so a repeated search answers in the same
 * order (FR-015a).
 *
 * The name is matched against the folded `name_search` column with the text
 * folded by the same rule (`lodz` finds `Łódź`, FR-011); the tax ID and legal
 * name as stored.
 */
export class OrganizationAdminSearchService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async search(
    query: OrganizationAdminSearchQuery,
    assignedOrganizationIds: readonly string[] | null,
  ): Promise<{ rows: OrganizationAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const contains = `%${query.likeEscaped}%`;
    const or: FilterQuery<Organization>[] = [];
    if (fields.has('name')) {
      const folded = normalizeOrganizationName(query.text);
      if (folded !== '') or.push({ nameSearch: { $ilike: `%${escapeLike(folded)}%` } });
    }
    // Stored tax IDs are normalised (`specs/177-tax-id-scope/` OD-11), so the
    // typed text is too: `pl 526-025` finds `PL526025…`.
    const taxIdText = normalizeTaxId(query.text);
    const hasTaxIdText = fields.has('taxId') && taxIdText !== '';
    if (hasTaxIdText) or.push({ taxId: { $ilike: `%${escapeLike(taxIdText)}%` } });
    if (fields.has('legalName')) or.push({ legalName: { $ilike: contains } });
    if (query.isUuid) or.push({ id: query.text });
    if (or.length === 0) return { rows: [], hasMore: false };

    const orderBy: Array<Record<string, QueryOrder>> = [];
    if (assignedOrganizationIds !== null && assignedOrganizationIds.length > 0) {
      const placeholders = assignedOrganizationIds.map(() => '?').join(', ');
      orderBy.push({
        [raw((alias) => `case when ${alias}.id::text in (${placeholders}) then 0 else 1 end`, [
          ...assignedOrganizationIds,
        ])]: QueryOrder.ASC,
      });
    }
    const exact: string[] = [];
    const params: string[] = [];
    if (query.isUuid) {
      exact.push('{a}.id::text = lower(?)');
      params.push(query.text);
    }
    if (hasTaxIdText) {
      exact.push('{a}.tax_id = ?');
      params.push(taxIdText);
    }
    if (exact.length > 0) {
      const starts = hasTaxIdText ? ' when {a}.tax_id ilike ? then 1' : '';
      if (hasTaxIdText) params.push(`${escapeLike(taxIdText)}%`);
      const sql = `case when ${exact.join(' or ')} then 0${starts} else 2 end`;
      orderBy.push({ [raw((alias) => sql.replace(/\{a\}/g, alias), params)]: QueryOrder.ASC });
    }
    orderBy.push({ updatedAt: QueryOrder.DESC }, { id: QueryOrder.ASC });

    const em = this.emFactory();
    const found = await em.find(
      Organization,
      // `Organization` is global, so the reach is applied on its own key.
      { deletedAt: null, isPersonal: false, $or: or, ...orgScopeWhere('id') },
      { orderBy: orderBy as never, limit: query.limit + 1 },
    );
    const hasMore = found.length > query.limit;
    return {
      hasMore,
      rows: found.slice(0, query.limit).map((org) => ({
        id: org.id,
        name: org.name,
        taxId: org.taxId ?? null,
        city: org.registeredAddress?.city ?? null,
        status: org.status,
      })),
    };
  }
}
