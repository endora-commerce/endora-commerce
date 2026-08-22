import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AdminRolePort,
  type AuthSessionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../../kernel/crypto/password-hasher.js';
import { AdminUser } from '../entities/admin-user.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';

/**
 * AdminUserService (T193 / FR-080..FR-083). Backs the admin panel's
 * Users & Roles module. Mutations are gated by `admin_users:manage` at the
 * route layer; this service trusts the caller and focuses on data integrity:
 *
 *   - email uniqueness (DB partial unique enforces, mapped to 409)
 *   - role existence on assignment
 *   - password rehash on create, on self-rotation, and on a peer reset
 *   - soft delete via `deletedAt`; status flip is the everyday lever
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
  /** Optional password rotation. When supplied the value is hashed
   *  before being persisted. */
  password?: string;
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
  ) {}

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
    if (input.adminRoleId) await this.#assertRoleExists(input.adminRoleId);
    const passwordHash = await hashPassword(input.password);
    const user = em.create(AdminUser, {
      email: normalizeEmailAddress(input.email),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      ...(input.adminRoleId ? { adminRoleId: input.adminRoleId } : {}),
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
      if (input.adminRoleId !== null) await this.#assertRoleExists(input.adminRoleId);
      user.adminRoleId = input.adminRoleId;
    }
    if (input.firstName !== undefined) user.firstName = input.firstName;
    if (input.lastName !== undefined) user.lastName = input.lastName;
    if (input.status !== undefined) user.status = input.status;
    if (input.password !== undefined) {
      user.passwordHash = await hashPassword(input.password);
    }
    this.#audit(em, 'admin_user.update', user.id, null, { email: user.email, status: user.status });
    await em.flush();
    return user;
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
   *  1. every session the target holds is revoked, and
   *  2. the new hash is persisted with an `admin_user.change_password` audit
   *     row that records the target and the route taken — never the password
   *     and never its hash.
   *
   * The revocation runs **before** the flush on purpose. It reaches another
   * module, so it can refuse; refusing first means the reset either takes
   * effect whole or not at all, where a flush-then-revoke order could leave a
   * changed password with the old password's sessions still answering. A
   * revocation that succeeded over a flush that then failed only signs the
   * target out, which their existing password undoes.
   *
   * No `catch` around the port call: an operator told "reset" while the old
   * sessions kept working would be told something false.
   */
  async resetPassword(id: string, newPassword: string): Promise<AdminUser> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    // Hashed before the revocation so the window between "signed out" and
    // "new password live" is not an argon2 pass wide.
    const passwordHash = await hashPassword(newPassword);
    await this.sessions.destroyAllForAdmin(user.id);
    user.passwordHash = passwordHash;
    this.#audit(em, 'admin_user.change_password', user.id, null, {
      email: user.email,
      via: 'peer_reset',
    });
    await em.flush();
    return user;
  }

  async softDelete(id: string): Promise<void> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    user.deletedAt = new Date();
    user.status = 'inactive';
    this.#audit(em, 'admin_user.delete', user.id, { email: user.email }, null);
    await em.flush();
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
