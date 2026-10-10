import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AdminRolePort,
  type AuthSessionPort,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword, verifyPassword } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../entities/admin-user.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/**
 * AdminUserService (T193 / FR-080..FR-083). Backs the admin panel's
 * Users & Roles module. Mutations are gated by `admin_users:manage` at the
 * route layer; this service trusts the caller and focuses on data integrity:
 *
 *   - email uniqueness (DB partial unique enforces, mapped to 409)
 *   - an account always holds a role: creating one without, or clearing the
 *     role of one that has it, is refused (`ADMIN_USER_ROLE_REQUIRED`)
 *   - role existence on assignment
 *   - password rehash on create, on self-rotation (which requires the current
 *     password), and on a peer reset
 *   - soft delete via `deletedAt`; status flip is the everyday lever
 *   - the account's sessions are revoked whenever what they stood for is
 *     withdrawn: all of them on a peer reset, a deactivation and a delete, all
 *     but the calling one on a self-service password change
 */

export interface CreateAdminUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  adminRoleId?: string | null;
}

export interface UpdateAdminUserInput {
  firstName?: string;
  lastName?: string;
  adminRoleId?: string | null;
  status?: 'active' | 'inactive';
}

/**
 * What an administrator may change about their own account. A new `password`
 * is only ever accepted together with `currentPassword`; the type keeps
 * `currentPassword` optional so that a caller which forgot it reaches the
 * refusal in {@link AdminUserService.updateSelf} instead of compiling its way
 * past it.
 */
export interface UpdateOwnAdminUserInput {
  firstName?: string;
  lastName?: string;
  password?: string;
  currentPassword?: string | undefined;
}

/** Where a self-service edit came from — what `updateSelf` needs besides the edit. */
export interface UpdateOwnAdminUserContext {
  /**
   * The raw admin session cookie the request carried. A password change
   * revokes every session the account holds except the one this resolves to.
   * Absent, or not resolving to a session of this administrator, means there
   * is no session to spare and all of them go.
   */
  sessionCookieValue?: string | undefined;
}

/** The refusal a self-service password change earns without the right current password. */
function currentPasswordInvalidRefusal(): HttpError {
  // 403 and not the 401 the buyer-side route answers with: the session is
  // valid, and the Admin UI treats every 401 as an expired session and signs
  // the administrator out — which a mistyped password must not do.
  return new HttpError(
    403,
    ERROR_CODES.CURRENT_PASSWORD_INVALID,
    'The current password is incorrect.',
  );
}

/**
 * The refusal a self-service password change earns when the new password is
 * the one the account already has.
 *
 * Such a request would be answered "changed" and would sign every other
 * session out while leaving the credential exactly as it was — the opposite of
 * what somebody changing a password they no longer trust is asking for. Only
 * raised once the current password has been verified, so it says nothing to a
 * caller who does not already know it.
 */
function newPasswordUnchangedRefusal(): HttpError {
  return new HttpError(
    400,
    ERROR_CODES.NEW_PASSWORD_UNCHANGED,
    'The new password is the same as the current one. Choose a different password.',
  );
}

export interface ListAdminUsersOptions {
  /** Case-insensitive substring on first name, last name, and email. Trimmed. */
  q?: string;
  /** Zero-indexed page (matches the catalog admin convention). */
  page?: number;
  /** Page size. Default 50, max 200. */
  pageSize?: number;
}

export interface ListAdminUsersResult {
  items: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * The refusal a write earns when it would leave an account without a role.
 *
 * An administrator's permissions and tenant reach are both read off the role,
 * so an account without one cannot act at all — and the platform refuses such
 * an account at sign-in time rather than guessing what it may reach. Refusing
 * the write is what keeps an operator from creating that state by accident.
 */
export function adminUserRoleRequiredRefusal(): HttpError {
  return new HttpError(
    400,
    ERROR_CODES.ADMIN_USER_ROLE_REQUIRED,
    'An administrator account must hold a role. Choose the role this account is given.',
  );
}

/**
 * What an operator is told at boot about accounts that have no role, or `null`
 * when there are none.
 *
 * Such accounts predate the rule above. They are deliberately **not** given a
 * role automatically — any default would hand out access nobody decided on —
 * so the state is made visible instead, with both ways to repair it. The CLI
 * one matters when the only administrator is affected: nobody can then sign in
 * to use the Admin UI.
 */
export function describeAdministratorsWithoutRole(count: number): string | null {
  if (count <= 0) return null;
  return (
    `${count} administrator account(s) hold no role and are refused until given one. ` +
    'Assign a role on the Users screen of the Admin UI, or from the command line with ' +
    '`admin_users create --email=<their e-mail> --password-stdin --first-name=<f> ' +
    '--last-name=<l> [--role=<code>]` (the instance script `admin:create`), which updates ' +
    'the existing account, sets the password given and assigns `platform_admin` unless ' +
    '`--role` names another role.'
  );
}

export class AdminUserService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * `admin_roles`' published role surface (feature 075, Phase C). The role
     * a user is assigned to belongs to that module, so "does this role exist?"
     * is its question and not a second `em.findOne` against its table.
     */
    private readonly adminRoles: AdminRolePort,
    /**
     * `auth`'s session surface (feature 075, Phase C). A password write has to
     * be able to withdraw the sessions the old password minted, and those rows
     * belong to `auth`.
     */
    private readonly sessions: AuthSessionPort,
    private readonly auditLog?: AuditPort,
    /**
     * `mfa`'s login port, resolved lazily and absent while `mfa` is — the same
     * accessor `AdminAuthService` signs in through. A login begun with a
     * password leaves a pending challenge or setup ticket there, and those are
     * withdrawn with the password they were issued under.
     */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
  ) {}

  /**
   * Withdraw what the account's credential had already been exchanged for:
   * its sessions (all, or all but `keepSessionId`) and its pending second-step
   * logins.
   *
   * **Called after the flush, never before.** Once the new state is committed
   * nothing new can be obtained with the old credential — sign-in reads the
   * row — so everything obtained earlier exists by now and is withdrawn here.
   * Revoking first left a window: a sign-in with the old password between the
   * revocation and the flush kept a session nothing would ever revoke. What
   * the ordering leaves is a sign-in that verified the old password *before*
   * the flush and mints its session *after* this call, a window of one request.
   *
   * No `catch`: a write that reported success while the old sessions kept
   * answering would be reporting something false. A refusal here surfaces as
   * the request's error, with the new password already in force.
   */
  async #withdrawCredentials(adminUserId: string, keepSessionId?: string): Promise<void> {
    await this.sessions.destroyAllForAdmin(
      adminUserId,
      keepSessionId === undefined ? undefined : { exceptSessionId: keepSessionId },
    );
    await this.getMfaLoginPort?.()?.invalidatePending({
      subjectType: 'admin',
      subjectId: adminUserId,
    });
  }

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'admin_user', objectId, stateBefore, stateAfter });
    }
  }

  /**
   * List non-deleted admin users with optional substring search and offset
   * pagination. When `q` is provided, results are ordered by a relevance
   * CASE: first-name prefix > first-name contains > last-name prefix >
   * last-name contains > email prefix > email contains, then by email.
   * When `q` is empty, results are ordered by email ASC (legacy default).
   *
   * Note: search is case-insensitive but NOT diacritic-insensitive on the
   * server side — Postgres `unaccent` is not enabled in this codebase. The
   * admin Combobox handles diacritic folding client-side when `manualFilter`
   * is off; the server falls back to plain `LOWER(...) LIKE`. If a future
   * picker (customers, products) needs diacritic-insensitive server search,
   * add `unaccent` via a migration.
   */
  async list(options: ListAdminUsersOptions = {}): Promise<ListAdminUsersResult> {
    const em = this.emFactory();
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 50), 200);
    const trimmedQ = options.q?.trim() ?? '';

    if (trimmedQ === '') {
      const [items, total] = await em.findAndCount(
        AdminUser,
        { deletedAt: null },
        { orderBy: { email: 'asc' }, offset: page * pageSize, limit: pageSize },
      );
      return { items, page, pageSize, total };
    }

    const knex = em.getKnex();
    const needle = trimmedQ.toLowerCase();
    const prefix = `${needle}%`;
    const contains = `%${needle}%`;

    const baseQuery = knex('admin_users')
      .whereNull('deleted_at')
      .andWhere((qb) => {
        qb.whereRaw('LOWER("first_name") LIKE ?', [contains])
          .orWhereRaw('LOWER("last_name") LIKE ?', [contains])
          .orWhereRaw('LOWER("email") LIKE ?', [contains]);
      });

    const totalRow = (await baseQuery
      .clone()
      .count<{ count: string | number }>('* as count')
      .first()) as { count: string | number } | undefined;
    const total = Number(totalRow?.count ?? 0);

    const idRows = (await baseQuery
      .clone()
      .select('id')
      .orderByRaw(
        `CASE
           WHEN LOWER("first_name") LIKE ? THEN 1
           WHEN LOWER("first_name") LIKE ? THEN 2
           WHEN LOWER("last_name")  LIKE ? THEN 3
           WHEN LOWER("last_name")  LIKE ? THEN 4
           WHEN LOWER("email")      LIKE ? THEN 5
           WHEN LOWER("email")      LIKE ? THEN 6
           ELSE 7
         END ASC, "email" ASC`,
        [prefix, contains, prefix, contains, prefix, contains],
      )
      .offset(page * pageSize)
      .limit(pageSize)) as Array<{ id: string }>;

    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return { items: [], page, pageSize, total };
    const found = await em.find(AdminUser, { id: { $in: ids } });
    // Preserve the SQL ordering — `find` with `$in` returns arbitrary order.
    const byId = new Map(found.map((u) => [u.id, u]));
    const items = ids.map((id) => byId.get(id)).filter((u): u is AdminUser => Boolean(u));
    return { items, page, pageSize, total };
  }

  async getById(id: string): Promise<AdminUser> {
    const em = this.emFactory();
    const row = await em.findOne(AdminUser, { id, deletedAt: null });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
    return row;
  }

  /**
   * Batch lookup for display enrichment (e.g. the audit-log actor column):
   * returns the found admin users for the given ids, tolerating unknown or
   * soft-deleted ids (they are simply omitted). Order is not guaranteed.
   */
  async listByIds(ids: string[]): Promise<AdminUser[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const em = this.emFactory();
    return em.find(AdminUser, { id: { $in: unique } });
  }

  async create(input: CreateAdminUserInput): Promise<AdminUser> {
    const em = this.emFactory();
    if (!input.adminRoleId) throw adminUserRoleRequiredRefusal();
    await this.#assertRoleExists(input.adminRoleId);
    const passwordHash = await hashPassword(input.password);
    const user = em.create(AdminUser, {
      email: normalizeEmailAddress(input.email),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      adminRoleId: input.adminRoleId,
      status: 'active',
    });
    this.#audit(em, 'admin_user.create', user.id, null, { email: user.email });
    try {
      await em.persistAndFlush(user);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.EMAIL_ALREADY_REGISTERED,
          'An admin user with that email already exists.',
        );
      }
      throw err;
    }
    return user;
  }

  async update(id: string, input: UpdateAdminUserInput): Promise<AdminUser> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    if (input.adminRoleId !== undefined) {
      // `null` used to clear the role. An account always holds one now, so the
      // only role change is one role for another.
      if (input.adminRoleId === null) throw adminUserRoleRequiredRefusal();
      await this.#assertRoleExists(input.adminRoleId);
      user.adminRoleId = input.adminRoleId;
    }
    if (input.firstName !== undefined) user.firstName = input.firstName;
    if (input.lastName !== undefined) user.lastName = input.lastName;
    if (input.status !== undefined) user.status = input.status;
    this.#audit(em, 'admin_user.update', user.id, null, { email: user.email, status: user.status });
    await em.flush();
    // A deactivated account must not keep answering on the sessions it already
    // holds, nor finish a login it had begun.
    if (input.status === 'inactive') await this.#withdrawCredentials(user.id);
    return user;
  }

  /**
   * An administrator edits their own account — `PATCH /api/v1/admin/me`.
   *
   * A new password is a credential change, so it is accepted only with the
   * current one, verified with `verifyPassword` — the same constant-time
   * argon2 verification sign-in uses. A session is not that proof: whoever
   * holds an unattended browser or a copied cookie holds a session, and
   * without this check could replace the password and keep the account.
   *
   * A new password equal to the current one is refused too
   * (`NEW_PASSWORD_UNCHANGED`): it would report a change, and sign the other
   * sessions out, without changing the credential.
   *
   * A refused attempt is **not** written to the audit log. That follows what
   * the module does for a failed sign-in, which is refused without a row; the
   * audit log records writes that happened.
   *
   * The verification runs **before anything is assigned**, and the new hash is
   * computed before the first assignment too, so the request takes effect
   * whole or not at all: a refused password change does not leave the name
   * half of the same request applied.
   *
   * A password change also **revokes every other session the account holds**
   * — the sign-ins on other browsers and the impersonations it started —
   * through the same `destroyAllForAdmin` a peer reset uses. Somebody changing
   * their password because another party may hold a session needs that
   * session gone, not merely unable to sign in again. The one session kept is
   * the caller's own, so the change does not throw them out of the screen they
   * made it on; it is taken from the request's cookie and counted only when it
   * resolves to an admin session of this very account.
   *
   * The revocation runs **after** the flush, as in `resetPassword` and for the
   * reason `#withdrawCredentials` gives. The two writes are not one
   * transaction — the sessions are `auth`'s rows and its Redis cache. Which
   * session is the caller's is worked out before anything is written.
   *
   * The audit trail tells the two halves apart. A password change is an
   * `admin_user.change_password` entry marked `via: 'self_service'` (a peer
   * reset is `via: 'peer_reset'`), and it carries neither password nor hash; a
   * name change is the `admin_user.update` entry it always was. A request that
   * does both records both.
   */
  async updateSelf(
    id: string,
    input: UpdateOwnAdminUserInput,
    context: UpdateOwnAdminUserContext = {},
  ): Promise<AdminUser> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    let passwordHash: string | undefined;
    if (input.password !== undefined) {
      if (
        input.currentPassword === undefined ||
        !(await verifyPassword(user.passwordHash, input.currentPassword))
      ) {
        throw currentPasswordInvalidRefusal();
      }
      // `currentPassword` has just been verified, so comparing the two strings
      // is comparing the new password with the stored one.
      if (input.password === input.currentPassword) throw newPasswordUnchangedRefusal();
      passwordHash = await hashPassword(input.password);
    }
    const editsProfile = input.firstName !== undefined || input.lastName !== undefined;
    const keep =
      passwordHash === undefined
        ? undefined
        : await this.#ownSessionId(user.id, context.sessionCookieValue);
    if (input.firstName !== undefined) user.firstName = input.firstName;
    if (input.lastName !== undefined) user.lastName = input.lastName;
    if (passwordHash !== undefined) {
      user.passwordHash = passwordHash;
      this.#audit(em, 'admin_user.change_password', user.id, null, {
        email: user.email,
        via: 'self_service',
      });
    }
    if (editsProfile || passwordHash === undefined) {
      this.#audit(em, 'admin_user.update', user.id, null, { email: user.email, status: user.status });
    }
    await em.flush();
    if (passwordHash !== undefined) await this.#withdrawCredentials(user.id, keep);
    return user;
  }

  /**
   * The id of the session `cookieValue` resolves to, when it is an admin
   * session of `adminUserId` — otherwise nothing. `loadSession` checks the
   * token, so a cookie that merely names another session's id spares nothing.
   */
  async #ownSessionId(
    adminUserId: string,
    cookieValue: string | undefined,
  ): Promise<string | undefined> {
    if (!cookieValue) return undefined;
    const resolved = await this.sessions.loadSession(cookieValue);
    if (resolved?.kind !== 'admin' || resolved.session.adminUserId !== adminUserId) {
      return undefined;
    }
    return resolved.session.id;
  }

  /**
   * Set an admin user's password on someone else's authority — issue #252.
   *
   * This is the module's password-write seam, and it is written to be the only
   * one: the e-mail-keyed self-service reset that follows the packaging
   * programme differs in **who is authorised** (a token instead of a peer's
   * `admin_users:manage`), not in what the write does. It calls this.
   *
   * Two things happen, in this order:
   *
   *  1. the new hash is persisted with an `admin_user.change_password` audit
   *     row that records the target and the route taken — never the password
   *     and never its hash, and
   *  2. every session the target holds is revoked — including, when an
   *     operator resets their own password here, the one making the request —
   *     and so is every login the target had begun and not finished.
   *
   * The order is `#withdrawCredentials`'s to explain: revoking first let a
   * sign-in with the old password, between the two steps, keep a session.
   */
  async resetPassword(id: string, newPassword: string): Promise<AdminUser> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    user.passwordHash = await hashPassword(newPassword);
    this.#audit(em, 'admin_user.change_password', user.id, null, {
      email: user.email,
      via: 'peer_reset',
    });
    await em.flush();
    await this.#withdrawCredentials(user.id);
    return user;
  }

  /**
   * The bootstrap command (`admin_users create`) run again for an account that
   * already exists: it sets the password, the name and the role, and puts the
   * account back in service — a deactivated or deleted one included.
   *
   * That is a credential change made on somebody else's authority, so it does
   * what `resetPassword` does: the write carries an
   * `admin_user.change_password` audit row, marked `via: 'cli'`, and once it
   * is committed every session the account holds and every login it had begun
   * is withdrawn. The row has no acting administrator: the command runs from a
   * shell on the host, outside any request, and no other operator command
   * records one either.
   */
  async restoreFromCli(
    id: string,
    input: { password: string; firstName: string; lastName: string; adminRoleId: string },
  ): Promise<AdminUser> {
    const em = this.emFactory();
    const user = await em.findOne(AdminUser, { id });
    if (!user) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
    user.passwordHash = await hashPassword(input.password);
    user.firstName = input.firstName;
    user.lastName = input.lastName;
    user.adminRoleId = input.adminRoleId;
    user.status = 'active';
    user.deletedAt = null;
    this.#audit(em, 'admin_user.change_password', user.id, null, {
      email: user.email,
      via: 'cli',
    });
    await em.flush();
    await this.#withdrawCredentials(user.id);
    return user;
  }

  /** Live accounts that hold no role — the state the boot notice reports. */
  async countWithoutRole(): Promise<number> {
    return this.emFactory().count(AdminUser, { adminRoleId: null, deletedAt: null });
  }

  async softDelete(id: string): Promise<void> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    user.deletedAt = new Date();
    user.status = 'inactive';
    this.#audit(em, 'admin_user.delete', user.id, { email: user.email }, null);
    await em.flush();
    // A deleted account's sessions, and any login it had begun, go with it.
    await this.#withdrawCredentials(user.id);
  }

  /**
   * Set (or revert) an admin user's preferred Admin UI language —
   * feature 019 / FR-002, FR-004, FR-006. Validation against the
   * supported allowlist lives at the route boundary so this method
   * trusts its input. Passing `null` reverts to the platform default
   * ("no preference saved" → resolver treats as English).
   */
  async setPreferredLanguage(
    id: string,
    preferredLanguage: string | null,
  ): Promise<AdminUser> {
    // command-coverage-ignore: per-admin Admin-UI language preference — personal
    // UI setting, not an audited domain-state mutation.
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    user.preferredLanguage = preferredLanguage;
    await em.flush();
    return user;
  }

  async #getByIdOn(em: EntityManager, id: string): Promise<AdminUser> {
    const row = await em.findOne(AdminUser, { id, deletedAt: null });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
    return row;
  }

  /**
   * `getById` raises the same 404 `Admin role not found.` this method used to
   * raise itself, so no `catch` is wanted and none is written: an absent
   * `admin_roles` must refuse the assignment, not let it through unvalidated.
   */
  async #assertRoleExists(id: string): Promise<void> {
    await this.adminRoles.getById(id);
  }
}
