import type { EntityManager } from '@mikro-orm/postgresql';
import {
  foldDiacritics,
  type AdminUserReadPort,
  type CustomerAccountReadPort,
  type OpportunityAssigneeLookupQuery,
  type OpportunityAssigneeOption,
  type OpportunityContactLookupQuery,
  type OpportunityContactOption,
  type OpportunityOrganizationLookupQuery,
  type OpportunityOrganizationOption,
  type OpportunitySalesChannelOption,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { isOrgInScope, orgConstraintFor } from '@endora-commerce/platform/tenancy';

export interface CrmLookupServiceDeps {
  emFactory: () => EntityManager;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  organizations: OrganizationDetailsPort;
  customerAccounts: CustomerAccountReadPort;
  adminUsers: AdminUserReadPort;
}

/** Case- and diacritic-insensitive "contains", as a person types a name. */
function matches(query: string | undefined, ...haystack: string[]): boolean {
  const needle = foldDiacritics(query ?? '').trim().toLowerCase();
  if (needle === '') return true;
  return haystack.some((value) => foldDiacritics(value).toLowerCase().includes(needle));
}

function personName(person: { firstName: string; lastName: string; email: string }): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

/**
 * What the CRM screens' pickers choose from
 * (`specs/143-crm-sales-opportunities/research.md` N-D4).
 *
 * **Why CRM answers these itself.** The admin lists that own these rows are
 * gated by their owners' codes — `customers:read`, `sales_channels:read`,
 * `admin_users:manage` — which a Sales Rep working Opportunities has no reason
 * to hold; the last one is the right to manage administrators. Each read here
 * goes through the owner's **published read port**, exactly as the Opportunity
 * screens already do to put a name beside an id, and answers the minimum a
 * picker shows. Nobody's gate is widened: the owners' endpoints answer 403 to
 * the same caller as before.
 *
 * **Tenant scope is applied here, by name.** `Organization` is the tenant, not
 * a tenant-scoped row, so its port answers whoever asks (research N-14); the
 * caller's reach is `orgConstraintFor()` / `isOrgInScope()`, the platform's own
 * answer, and an Organization out of reach is not listed, not labelled, and has
 * no contact persons to offer.
 */
export class CrmLookupService {
  constructor(private readonly deps: CrmLookupServiceDeps) {}

  async organizations(
    query: OpportunityOrganizationLookupQuery,
  ): Promise<OpportunityOrganizationOption[]> {
    const option = (row: { id: string; name: string }): OpportunityOrganizationOption => ({
      id: row.id,
      name: row.name,
    });
    if (query.id !== undefined) {
      if (!isOrgInScope(query.id)) return [];
      const found = await this.deps.organizations.findById(query.id);
      return found ? [option(found)] : [];
    }
    const constraint = orgConstraintFor();
    if (constraint.kind === 'all') {
      return (await this.deps.organizations.searchByName(query.q ?? '', query.limit)).map(option);
    }
    // A confined administrator: the allowed set is the population, and the
    // search narrows it — never the other way round, where a page of matches
    // taken platform-wide could hold none of the caller's Organizations.
    const allowed =
      constraint.kind === 'set'
        ? [...constraint.organizationIds]
        : constraint.organizationId
          ? [constraint.organizationId]
          : [];
    if (allowed.length === 0) return [];
    return (await this.deps.organizations.findByIds(allowed))
      .filter((row) => matches(query.q, row.name))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, query.limit)
      .map(option);
  }

  /** Every Sales Channel, by code. Channels are platform configuration, not tenant data. */
  async salesChannels(): Promise<OpportunitySalesChannelOption[]> {
    const channels = await this.deps
      .emFactory()
      .find(SalesChannel, {}, { orderBy: { code: 'asc' } });
    return channels.map((channel) => ({
      id: channel.id,
      code: channel.code,
      name: channel.name,
      active: channel.active,
      systemDefault: channel.systemDefault,
      defaultCurrency: channel.defaultCurrency,
      currencies: channel.currencies,
    }));
  }

  /** The administrators who may be assigned: active, not deleted — the rule `POST /assign` holds. */
  async assignees(query: OpportunityAssigneeLookupQuery): Promise<OpportunityAssigneeOption[]> {
    return (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter((admin) => admin.status === 'active' && admin.deletedAt === null)
      .filter((admin) => matches(query.q, personName(admin), admin.email))
      .map((admin) => ({ id: admin.id, name: personName(admin) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .slice(0, query.limit);
  }

  /** The members of one Organization the caller may reach; of any other, none. */
  async contacts(query: OpportunityContactLookupQuery): Promise<OpportunityContactOption[]> {
    if (!isOrgInScope(query.organizationId)) return [];
    return (
      await this.deps.customerAccounts.listByOrganization(query.organizationId, { activeOnly: true })
    )
      .filter((account) => matches(query.q, personName(account), account.email))
      .slice(0, query.limit)
      .map((account) => ({ id: account.id, name: personName(account), email: account.email }));
  }
}
