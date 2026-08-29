import type {
  AdminCustomerDetail,
  AdminCustomerListItem,
  CustomerAccountAdminSearchPort,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  CustomerGroupReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { CustomerDefaultsService } from './customer-defaults-service.js';

/**
 * CustomerAdminQueryService — the admin customer list + detail (feature 040,
 * US5). Applies the same visibility scope as moderation: a Platform
 * Administrator sees everyone; a Salesperson sees standalone customers plus
 * customers of the Organizations they are assigned to.
 *
 * **Feature 075, Phase C — the three foreign tables are three ports now.** The
 * account page, the organisation names beside it and the customer-group names
 * were all `em.find` calls on other modules' entities. The scope decision stays
 * here, because it is this module's: the port takes the organisations the actor
 * may see and does not decide who the actor is.
 *
 * **Feature 080, T048 (D-169) — and so is the fourth.** The detail header's
 * sales-channel list was the last `orders` entity this module named:
 * `em.find(Order, { placedByCustomerAccountId }, { fields: ['salesChannelId'] })`.
 * It is a plain read, so it took a read-port method
 * (`OrderReadPort.salesChannelIdsForCustomer`) and not an
 * `EntityManager`-taking apply port — handing a read a transaction handle
 * re-opens a write seam to serve it. With that gone this service holds no
 * `EntityManager` at all: it owns no table, and every question it answers is
 * somebody's published read.
 */
export interface AdminCustomerListScope {
  isPlatformAdmin: boolean;
  allowedOrganizationIds: string[];
}

export interface AdminCustomerListQuery {
  q?: string | undefined;
  status?: 'active' | 'blocked' | 'deleted' | undefined;
  organizationId?: string | undefined;
  customerGroupId?: string | undefined;
  page: number;
  pageSize: number;
}

export interface AdminCustomerListResult {
  rows: AdminCustomerListItem[];
  total: number;
}

export interface CustomerAdminQueryPorts {
  accounts: CustomerAccountReadPort;
  accountSearch: CustomerAccountAdminSearchPort;
  organizations: OrganizationDetailsPort;
  customerGroups: CustomerGroupReadPort;
  orders: OrderReadPort;
}

export class CustomerAdminQueryService {
  constructor(
    private readonly defaults: CustomerDefaultsService,
    private readonly ports: CustomerAdminQueryPorts,
  ) {}

  async list(
    query: AdminCustomerListQuery,
    scope: AdminCustomerListScope,
  ): Promise<AdminCustomerListResult> {
    const { rows, total } = await this.ports.accountSearch.search({
      q: query.q,
      status: query.status,
      organizationId: query.organizationId,
      customerGroupId: query.customerGroupId,
      // `null` is the unscoped read. A salesperson gets their territory, and
      // org-less customers are visible to every salesperson by construction.
      allowedOrganizationIds: scope.isPlatformAdmin ? null : scope.allowedOrganizationIds,
      page: query.page,
      pageSize: query.pageSize,
    });

    const { orgNames, groupNames } = await this.resolveNames(rows);
    return {
      rows: rows.map((c) => this.toListItem(c, orgNames, groupNames)),
      total,
    };
  }

  async getDetail(id: string): Promise<AdminCustomerDetail | null> {
    const customer = await this.ports.accounts.findById(id);
    if (!customer) return null;

    const { orgNames, groupNames } = await this.resolveNames([customer]);
    const base = this.toListItem(customer, orgNames, groupNames);

    // Already distinct, newest-ordered-on first — the owner does both, because
    // the deduplication is what makes the ordering mean anything.
    const salesChannelIds = await this.ports.orders.salesChannelIdsForCustomer(customer.id);

    const defaults = await this.defaults.getForCustomer(customer.id);

    return {
      ...base,
      block: customer.blockedAt
        ? {
            blockedAt: customer.blockedAt.toISOString(),
            blockSource: customer.blockSource ?? 'staff',
            blockReason: customer.blockReason ?? null,
            blockedByAdminUserId: customer.blockedByAdminUserId ?? null,
            blockedByCustomerAccountId: customer.blockedByCustomerAccountId ?? null,
          }
        : null,
      deletion: customer.deletedAt
        ? {
            deletedAt: customer.deletedAt.toISOString(),
            anonymizedAt: customer.anonymizedAt ? customer.anonymizedAt.toISOString() : null,
            restorableUntil: null,
          }
        : null,
      emailVerifiedAt: customer.emailVerifiedAt ? customer.emailVerifiedAt.toISOString() : null,
      twoFactorEnabled: customer.twoFactorEnabled,
      salesChannelIds,
      defaults,
      customFieldValues: customer.customFieldValues ?? {},
    };
  }

  private async resolveNames(
    rows: readonly CustomerAccountRecord[],
  ): Promise<{ orgNames: Map<string, string>; groupNames: Map<string, string> }> {
    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    const groupIds = [
      ...new Set(rows.map((r) => r.customerGroupId).filter((x): x is string => !!x)),
    ];
    const orgNames = new Map<string, string>();
    const groupNames = new Map<string, string>();
    if (orgIds.length) {
      for (const o of await this.ports.organizations.findByIds(orgIds)) {
        orgNames.set(o.id, o.name);
      }
    }
    if (groupIds.length) {
      for (const g of await this.ports.customerGroups.findByIds(groupIds)) {
        groupNames.set(g.id, g.name);
      }
    }
    return { orgNames, groupNames };
  }

  private toListItem(
    c: CustomerAccountRecord,
    orgNames: Map<string, string>,
    groupNames: Map<string, string>,
  ): AdminCustomerListItem {
    return {
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      organizationId: c.organizationId ?? null,
      organizationName: c.organizationId ? orgNames.get(c.organizationId) ?? null : null,
      customerGroupId: c.customerGroupId ?? null,
      customerGroupName: c.customerGroupId ? groupNames.get(c.customerGroupId) ?? null : null,
      blocked: c.blockedAt != null,
      deleted: c.deletedAt != null,
      createdAt: c.createdAt.toISOString(),
      lastLoginAt: c.lastLoginAt ? c.lastLoginAt.toISOString() : null,
    };
  }
}
