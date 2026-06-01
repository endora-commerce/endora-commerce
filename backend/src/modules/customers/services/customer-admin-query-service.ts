import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type { AdminCustomerDetail, AdminCustomerListItem } from '@b2b/contracts';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { CustomerGroup } from '../../price_lists/entities/customer-group.entity.js';
import { Order } from '../../orders/entities/order.entity.js';
import type { CustomerDefaultsService } from './customer-defaults-service.js';

/**
 * CustomerAdminQueryService — the admin customer list + detail (feature 040,
 * US5). Applies the same visibility scope as moderation: a Platform
 * Administrator sees everyone; a Salesperson sees standalone customers plus
 * customers of the Organizations they are assigned to.
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

export class CustomerAdminQueryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly defaults: CustomerDefaultsService,
  ) {}

  async list(
    query: AdminCustomerListQuery,
    scope: AdminCustomerListScope,
  ): Promise<AdminCustomerListResult> {
    const em = this.emFactory();
    const and: FilterQuery<CustomerAccount>[] = [];

    // Lifecycle status.
    if (query.status === 'blocked') {
      and.push({ blockedAt: { $ne: null }, deletedAt: null });
    } else if (query.status === 'deleted') {
      and.push({ deletedAt: { $ne: null } });
    } else {
      // Default "active" view excludes deleted accounts.
      and.push({ deletedAt: null });
    }

    if (query.organizationId) and.push({ organizationId: query.organizationId });
    if (query.customerGroupId) and.push({ customerGroupId: query.customerGroupId });

    // Visibility scope.
    if (!scope.isPlatformAdmin) {
      and.push({
        $or: [
          { organizationId: null },
          { organizationId: { $in: scope.allowedOrganizationIds } },
        ],
      });
    }

    // Free-text search over email / first / last name.
    if (query.q && query.q.trim()) {
      const like = `%${query.q.trim()}%`;
      and.push({
        $or: [
          { email: { $ilike: like } },
          { firstName: { $ilike: like } },
          { lastName: { $ilike: like } },
        ],
      });
    }

    const where: FilterQuery<CustomerAccount> = and.length ? { $and: and } : {};
    const offset = (query.page - 1) * query.pageSize;
    const [rows, total] = await em.findAndCount(CustomerAccount, where, {
      orderBy: { createdAt: 'desc' },
      limit: query.pageSize,
      offset,
    });

    const { orgNames, groupNames } = await this.resolveNames(em, rows);
    return {
      rows: rows.map((c) => this.toListItem(c, orgNames, groupNames)),
      total,
    };
  }

  async getDetail(id: string): Promise<AdminCustomerDetail | null> {
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, { id });
    if (!customer) return null;

    const { orgNames, groupNames } = await this.resolveNames(em, [customer]);
    const base = this.toListItem(customer, orgNames, groupNames);

    const salesChannelIds = (
      await em.find(
        Order,
        { placedByCustomerAccountId: customer.id },
        { fields: ['salesChannelId'] },
      )
    ).map((o) => o.salesChannelId);

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
      twoFactorEnabled: customer.twoFactorConfirmedAt != null,
      salesChannelIds: [...new Set(salesChannelIds)],
      defaults,
    };
  }

  private async resolveNames(
    em: EntityManager,
    rows: CustomerAccount[],
  ): Promise<{ orgNames: Map<string, string>; groupNames: Map<string, string> }> {
    const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((x): x is string => !!x))];
    const groupIds = [...new Set(rows.map((r) => r.customerGroupId).filter((x): x is string => !!x))];
    const orgNames = new Map<string, string>();
    const groupNames = new Map<string, string>();
    if (orgIds.length) {
      for (const o of await em.find(Organization, { id: { $in: orgIds } }, { fields: ['id', 'name'] })) {
        orgNames.set(o.id, o.name);
      }
    }
    if (groupIds.length) {
      for (const g of await em.find(CustomerGroup, { id: { $in: groupIds } }, { fields: ['id', 'name'] })) {
        groupNames.set(g.id, g.name);
      }
    }
    return { orgNames, groupNames };
  }

  private toListItem(
    c: CustomerAccount,
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
