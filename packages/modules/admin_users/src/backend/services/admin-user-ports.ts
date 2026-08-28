import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeEmailAddress } from '@endora-commerce/contracts';
import type {
  AdminPasswordVerificationPort,
  AdminUserLookupOptions,
  AdminUserPreferencePort,
  AdminUserReadPort,
  AdminUserRecord,
  ImpersonationPort,
} from '@endora-commerce/contracts';
import { verifyPassword } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../entities/admin-user.entity.js';
import type { AdminUserService } from './admin-user-service.js';
import type { ImpersonationService } from './impersonation-service.js';
import type { TwoFactorEnrolmentReader } from './two-factor-enrolments.js';

/**
 * The published face of `admin_users` (feature 075, Phase P).
 *
 * Seven of the eleven inbound sites read the `AdminUser` entity to put a name
 * beside an id: `admin_roles` resolving a user's role, `quote_requests`
 * listing the admins a notification goes to, `catalog` attributing a bulk
 * operation, `organizations` rendering the sales-rep picker.
 *
 * `passwordHash` does not survive the mapping, for the reason
 * `CustomerAccountRecord` gives: exactly one module reads it.
 */
export class AdminUserReadService implements AdminUserReadPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly twoFactorEnrolments: TwoFactorEnrolmentReader,
  ) {}

  async findById(id: string, options?: AdminUserLookupOptions): Promise<AdminUserRecord | null> {
    const admin = await this.emFactory().findOne(AdminUser, { id, ...activeFilter(options) });
    return admin ? (await toAdminUserRecords(this.twoFactorEnrolments, [admin]))[0]! : null;
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
    return toAdminUserRecords(this.twoFactorEnrolments, admins);
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
    return admin ? (await toAdminUserRecords(this.twoFactorEnrolments, [admin]))[0]! : null;
  }

  async listAll(options?: AdminUserLookupOptions): Promise<AdminUserRecord[]> {
    const admins = await this.emFactory().find(
      AdminUser,
      activeFilter(options),
      { orderBy: { email: 'asc' } },
    );
    return toAdminUserRecords(this.twoFactorEnrolments, admins);
  }

  async listByRoleId(adminRoleId: string): Promise<AdminUserRecord[]> {
    const admins = await this.emFactory().find(
      AdminUser,
      { adminRoleId },
      { orderBy: { email: 'asc' } },
    );
    return toAdminUserRecords(this.twoFactorEnrolments, admins);
  }
}

function activeFilter(options?: AdminUserLookupOptions): { deletedAt?: null } {
  return options?.activeOnly ? { deletedAt: null } : {};
}

/**
 * Step-up re-verification, for `mfa` (feature 080, T052).
 *
 * The read is `admin_users`' own row and the comparison is the platform
 * hasher's, so both halves are on this side of the seam. The composition roots
 * held them instead: each read `passwordHash` off the entity and called
 * `verifyPassword` itself, which is a credential column and a hash comparison
 * living in a file that owns neither.
 *
 * The hash never leaves this function — that is the difference between this
 * port and a `passwordHash` field on `AdminUserRecord`, and it is the whole
 * reason the port exists.
 */
export function createAdminPasswordVerificationPort(
  emFactory: () => EntityManager,
): AdminPasswordVerificationPort {
  return {
    async verifyPassword(adminUserId, password) {
      const admin = await emFactory().findOne(AdminUser, { id: adminUserId });
      // The bare call is the imported hasher: an object method name is not a
      // binding, so it shadows nothing.
      return admin ? verifyPassword(admin.passwordHash, password) : false;
    },
  };
}

/** `_i18n` writes the admin's language choice and reads nothing else. */
export function createAdminUserPreferencePort(
  getService: () => AdminUserService,
  twoFactorEnrolments: TwoFactorEnrolmentReader,
): AdminUserPreferencePort {
  return {
    async setPreferredLanguage(id, preferredLanguage) {
      const admin = await getService().setPreferredLanguage(id, preferredLanguage);
      return (await toAdminUserRecords(twoFactorEnrolments, [admin]))[0]!;
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

/**
 * The published record, with `twoFactorEnabled` taken from `mfa` rather than
 * from this module's `two_factor_confirmed_at` column.
 *
 * The second parameter is required and has no default on purpose. The column it
 * replaces had no writer on this table — ever — so the field was a provably
 * constant `false` on `/admin-users`, on `/admin/me` and on every consumer of
 * this record. A default would have let the next call site reintroduce exactly
 * that, silently; making the caller answer means the compiler asks.
 */
export function toAdminUserRecord(admin: AdminUser, twoFactorEnabled: boolean): AdminUserRecord {
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.firstName,
    lastName: admin.lastName,
    adminRoleId: admin.adminRoleId ?? null,
    status: admin.status,
    twoFactorEnabled,
    lastLoginAt: admin.lastLoginAt ?? null,
    preferredLanguage: admin.preferredLanguage ?? null,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    deletedAt: admin.deletedAt ?? null,
  };
}

/**
 * One `mfa` read for a whole page of admins, rather than one per row.
 *
 * Every caller of this mapper is a list or a single entity, so batching here
 * keeps `/admin-users` at two queries instead of one per user, and leaves the
 * single-row callers spelling the same thing.
 */
export async function toAdminUserRecords(
  twoFactorEnrolments: TwoFactorEnrolmentReader,
  admins: readonly AdminUser[],
): Promise<AdminUserRecord[]> {
  if (admins.length === 0) return [];
  const enrolled = await twoFactorEnrolments(admins.map((admin) => admin.id));
  return admins.map((admin) => toAdminUserRecord(admin, enrolled.has(admin.id)));
}
