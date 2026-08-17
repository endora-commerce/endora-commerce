import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountLookupOptions,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  CustomerAccountRole,
  CustomerAuthPort,
  CustomerRolePort,
} from '@b2b/contracts';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import type { CustomerAuthService } from './customer-auth-service.js';
import type { RoleService } from './role-service.js';

/**
 * The published face of `customer_accounts` (feature 075, Phase P).
 *
 * Nineteen modules read this module's table today, 51 of the sites on the
 * entity class itself. What they ask for is narrow — an account by id, by ids,
 * by e-mail, by organisation, and the two counting questions the "an
 * organisation keeps at least one admin" rule is spelled with — so that is
 * what the read port is, rather than the table.
 *
 * The mapping below is the point of the exercise and not ceremony:
 * `passwordHash` and `twoFactorSecret` do not survive it. Both are read by
 * exactly one module, and a record that carried them would turn every consumer
 * into a place a credential can leak from.
 */

export function toCustomerAccountRecord(account: CustomerAccount): CustomerAccountRecord {
  return {
    id: account.id,
    organizationId: account.organizationId ?? null,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    role: account.role,
    emailVerifiedAt: account.emailVerifiedAt ?? null,
    twoFactorEnabled: Boolean(account.twoFactorConfirmedAt),
    lastLoginAt: account.lastLoginAt ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    customFieldValues: account.customFieldValues ?? {},
    deletedAt: account.deletedAt ?? null,
    customerGroupId: account.customerGroupId ?? null,
    subtreeRollupEnabled: account.subtreeRollupEnabled,
    blockedAt: account.blockedAt ?? null,
    blockReason: account.blockReason ?? null,
    blockSource: account.blockSource ?? null,
    blockedByAdminUserId: account.blockedByAdminUserId ?? null,
    blockedByCustomerAccountId: account.blockedByCustomerAccountId ?? null,
    deletionRequestedByAdminUserId: account.deletionRequestedByAdminUserId ?? null,
    anonymizedAt: account.anonymizedAt ?? null,
  };
}

/** `{ deletedAt: null }` when the caller asked for it, nothing otherwise. */
function activeFilter(options?: CustomerAccountLookupOptions): { deletedAt?: null } {
  return options?.activeOnly ? { deletedAt: null } : {};
}

export class CustomerAccountReadService implements CustomerAccountReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(
    id: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    const account = await this.emFactory().findOne(CustomerAccount, {
      id,
      ...activeFilter(options),
    });
    return account ? toCustomerAccountRecord(account) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]> {
    if (ids.length === 0) return [];
    const accounts = await this.emFactory().find(CustomerAccount, {
      id: { $in: [...ids] },
      ...activeFilter(options),
    });
    return accounts.map(toCustomerAccountRecord);
  }

  async findByEmail(
    email: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    const account = await this.emFactory().findOne(CustomerAccount, {
      email,
      ...activeFilter(options),
    });
    return account ? toCustomerAccountRecord(account) : null;
  }

  async findInOrganization(
    id: string,
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null> {
    const account = await this.emFactory().findOne(CustomerAccount, {
      id,
      organizationId,
      ...activeFilter(options),
    });
    return account ? toCustomerAccountRecord(account) : null;
  }

  async listByOrganization(
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]> {
    const accounts = await this.emFactory().find(
      CustomerAccount,
      { organizationId, ...activeFilter(options) },
      { orderBy: { role: 'asc', createdAt: 'asc' } },
    );
    return accounts.map(toCustomerAccountRecord);
  }

  async countByOrganizationRole(
    organizationId: string,
    role: CustomerAccountRole,
    options?: {
      excludeCustomerAccountId?: string;
      activeOnly?: boolean;
      notBlocked?: boolean;
    },
  ): Promise<number> {
    return this.emFactory().count(CustomerAccount, {
      organizationId,
      role,
      ...(options?.activeOnly ? { deletedAt: null } : {}),
      ...(options?.notBlocked ? { blockedAt: null } : {}),
      ...(options?.excludeCustomerAccountId
        ? { id: { $ne: options.excludeCustomerAccountId } }
        : {}),
    });
  }

  async listAll(): Promise<CustomerAccountRecord[]> {
    const accounts = await this.emFactory().find(
      CustomerAccount,
      {},
      { orderBy: { email: 'asc' } },
    );
    return accounts.map(toCustomerAccountRecord);
  }
}

/**
 * `CustomerAuthService.login` resolves to a `LoginResult` carrying the
 * `CustomerAccount` entity. The port hands back the record instead — the same
 * substitution the read service makes, for the same reason.
 *
 * The service arrives as a **getter** rather than a value so the adapter reads
 * it from the container per call. Constructing a second `CustomerAuthService`
 * here is precisely the divergence this module's conversion removed: the two
 * composition roots each built one, and their MFA argument differed.
 */
export function createCustomerAuthPort(getService: () => CustomerAuthService): CustomerAuthPort {
  return {
    async login(input) {
      const outcome = await getService().login(input);
      if (outcome.status !== 'authenticated') return outcome;
      return {
        status: 'authenticated',
        customerAccount: toCustomerAccountRecord(outcome.customerAccount),
        sessionCookieValue: outcome.sessionCookieValue,
        sessionExpiresAt: outcome.sessionExpiresAt,
      };
    },
    changePassword: (customerAccountId, currentPassword, newPassword) =>
      getService().changePassword(customerAccountId, currentPassword, newPassword),
    logout: (sessionId) => getService().logout(sessionId),
  };
}

/** Same substitution for the member-management surface `organizations` calls. */
export function createCustomerRolePort(getService: () => RoleService): CustomerRolePort {
  return {
    async listMembers(organizationId) {
      return (await getService().listMembers(organizationId)).map(toCustomerAccountRecord);
    },
    async changeRole(organizationId, targetCustomerAccountId, newRole) {
      return toCustomerAccountRecord(
        await getService().changeRole(organizationId, targetCustomerAccountId, newRole),
      );
    },
    removeMember: (organizationId, targetCustomerAccountId) =>
      getService().removeMember(organizationId, targetCustomerAccountId),
  };
}
