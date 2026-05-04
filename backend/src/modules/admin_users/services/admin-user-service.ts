import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword } from '../../auth/services/password-hasher.js';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminRole } from '../../admin_roles/entities/admin-role.entity.js';

/**
 * AdminUserService (T193 / FR-080..FR-083). Backs the admin panel's
 * Users & Roles module. Mutations are gated by `admin_users:manage` at the
 * route layer; this service trusts the caller and focuses on data integrity:
 *
 *   - email uniqueness (DB partial unique enforces, mapped to 409)
 *   - role existence on assignment
 *   - password rehash on create only (rotation lives elsewhere)
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

export class AdminUserService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(): Promise<AdminUser[]> {
    const em = this.emFactory();
    return em.find(AdminUser, { deletedAt: null }, { orderBy: { email: 'asc' } });
  }

  async getById(id: string): Promise<AdminUser> {
    const em = this.emFactory();
    const row = await em.findOne(AdminUser, { id, deletedAt: null });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
    return row;
  }

  async create(input: CreateAdminUserInput): Promise<AdminUser> {
    const em = this.emFactory();
    if (input.adminRoleId) await this.#assertRoleExists(em, input.adminRoleId);
    const passwordHash = await hashPassword(input.password);
    const user = em.create(AdminUser, {
      email: input.email.toLowerCase(),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      ...(input.adminRoleId ? { adminRoleId: input.adminRoleId } : {}),
      status: 'active',
    });
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
      if (input.adminRoleId !== null) await this.#assertRoleExists(em, input.adminRoleId);
      user.adminRoleId = input.adminRoleId;
    }
    if (input.firstName !== undefined) user.firstName = input.firstName;
    if (input.lastName !== undefined) user.lastName = input.lastName;
    if (input.status !== undefined) user.status = input.status;
    if (input.password !== undefined) {
      user.passwordHash = await hashPassword(input.password);
    }
    await em.flush();
    return user;
  }

  async softDelete(id: string): Promise<void> {
    const em = this.emFactory();
    const user = await this.#getByIdOn(em, id);
    user.deletedAt = new Date();
    user.status = 'inactive';
    await em.flush();
  }

  async #getByIdOn(em: EntityManager, id: string): Promise<AdminUser> {
    const row = await em.findOne(AdminUser, { id, deletedAt: null });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
    return row;
  }

  async #assertRoleExists(em: EntityManager, id: string): Promise<void> {
    const role = await em.findOne(AdminRole, { id });
    if (!role) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
    }
  }
}
