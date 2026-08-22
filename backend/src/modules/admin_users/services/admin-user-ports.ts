import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeEmailAddress } from '@endora-commerce/contracts';
import type {
  AdminUserLookupOptions,
  AdminUserPreferencePort,
  AdminUserReadPort,
  AdminUserRecord,
  ImpersonationPort,
} from '@endora-commerce/contracts';
import { AdminUser } from '../entities/admin-user.entity.js';
import type { AdminUserService } from './admin-user-service.js';
import type { ImpersonationService } from './impersonation-service.js';

/**
 * The published face of `admin_users` (feature 075, Phase P).
 *
 * Seven of the eleven inbound sites read the `AdminUser` entity to put a name
 * beside an id: `admin_roles` resolving a user's role, `quote_requests`
 * listing the admins a notification goes to, `catalog` attributing a bulk
 * operation, `organizations` rendering the sales-rep picker.
 *
 * `passwordHash` and `twoFactorSecret` do not survive the mapping, for the
 * reason `CustomerAccountRecord` gives: exactly one module reads either.
 */
export class AdminUserReadService implements AdminUserReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string, options?: AdminUserLookupOptions): Promise<AdminUserRecord | null> {
    const admin = await this.emFactory().findOne(AdminUser, { id, ...activeFilter(options) });
    return admin ? toAdminUserRecord(admin) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: AdminUserLookupOptions,
  ): Promise<AdminUserRecord[]> {
    if (ids.length === 0) return [];
    const admins = await this.emFactory().find(AdminUser, {
      id: { $in: [...ids] },
      ...activeFilter(options),
    });
    return admins.map(toAdminUserRecord);
  }

  async findByEmail(
    email: string,
    options?: AdminUserLookupOptions,
  ): Promise<AdminUserRecord | null> {
    // Folded before the comparison, like every other read of this column: the
    // callers that reach this method arrive from entrances that go through no
    // request schema — the bootstrap CLI, an identity provider's claim — so the
    // spelling they hand over is whatever their source held.
    const admin = await this.emFactory().findOne(AdminUser, {
      email: normalizeEmailAddress(email),
      ...activeFilter(options),
    });
    return admin ? toAdminUserRecord(admin) : null;
  }

  async listAll(options?: AdminUserLookupOptions): Promise<AdminUserRecord[]> {
    const admins = await this.emFactory().find(
      AdminUser,
      activeFilter(options),
      { orderBy: { email: 'asc' } },
    );
    return admins.map(toAdminUserRecord);
  }

  async listByRoleId(adminRoleId: string): Promise<AdminUserRecord[]> {
    const admins = await this.emFactory().find(
      AdminUser,
      { adminRoleId },
      { orderBy: { email: 'asc' } },
    );
    return admins.map(toAdminUserRecord);
  }
}

function activeFilter(options?: AdminUserLookupOptions): { deletedAt?: null } {
  return options?.activeOnly ? { deletedAt: null } : {};
}

/** `_i18n` writes the admin's language choice and reads nothing else. */
export function createAdminUserPreferencePort(
  getService: () => AdminUserService,
): AdminUserPreferencePort {
  return {
    async setPreferredLanguage(id, preferredLanguage) {
      return toAdminUserRecord(await getService().setPreferredLanguage(id, preferredLanguage));
    },
  };
}

/**
 * `customers` hosts the "view as this customer" control, so the surface and
 * the machinery sit in different modules by design.
 *
 * The only substitution the adapter makes is `impersonatedCustomerAccount`:
 * the service answers with the `CustomerAccount` entity, and the port with the
 * four fields the one consumer renders. Mapping to a full
 * `CustomerAccountRecord` here would mean importing `customer_accounts`'
 * mapper — a new cross-module edge, in the merge request whose job is to
 * remove them.
 */
export function createImpersonationPort(
  getService: () => ImpersonationService,
): ImpersonationPort {
  return {
    async start(input) {
      const started = await getService().start(input);
      return {
        impersonationSessionId: started.impersonationSessionId,
        impersonationCookieValue: started.impersonationCookieValue,
        impersonationExpiresAt: started.impersonationExpiresAt,
        adminShadowSessionCookieValue: started.adminShadowSessionCookieValue,
        impersonatedCustomerAccount: {
          id: started.impersonatedCustomerAccount.id,
          email: started.impersonatedCustomerAccount.email,
          firstName: started.impersonatedCustomerAccount.firstName,
          lastName: started.impersonatedCustomerAccount.lastName,
        },
      };
    },
    end: (input) => getService().end(input),
  };
}

export function toAdminUserRecord(admin: AdminUser): AdminUserRecord {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    adminRoleId: admin.adminRoleId ?? null,
    status: admin.status,
    twoFactorEnabled: Boolean(admin.twoFactorConfirmedAt),
    lastLoginAt: admin.lastLoginAt ?? null,
    preferredLanguage: admin.preferredLanguage ?? null,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    deletedAt: admin.deletedAt ?? null,
  };
}
