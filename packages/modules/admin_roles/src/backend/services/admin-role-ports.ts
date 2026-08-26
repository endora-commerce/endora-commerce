import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminRolePort, AdminRoleRecord, SystemRoleCodePort } from '@endora-commerce/contracts';
import { AdminRole } from '../entities/admin-role.entity.js';
import {
  type AdminRoleService,
  listSystemRoleCodes,
  registerSystemRoleCode,
} from './admin-role-service.js';

/**
 * The published face of `admin_roles` (feature 075, Phase P).
 *
 * Fourteen inbound sites: `admin_users` reads a role beside its user and
 * enforces `requiresTwoFactor` at login, `admin_actions` filters the command
 * palette by a user's permissions, `blog` protects the role it seeds, and the
 * dev seed creates one.
 *
 * `findByCode` is the method with no direct predecessor. `admin_users`'
 * service and the dev seed both look a role up by code with
 * `em.findOne(AdminRole, { code })`, which is the read it replaces.
 */
export class AdminRoleReadService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findByCode(code: string): Promise<AdminRoleRecord | null> {
    const role = await this.emFactory().findOne(AdminRole, { code });
    return role ? toAdminRoleRecord(role) : null;
  }
}

/**
 * The full role port, adapting `AdminRoleService` and adding the by-code
 * lookup. The service arrives as a getter so the adapter resolves it per call
 * rather than capturing it.
 */
export function createAdminRolePort(
  emFactory: () => EntityManager,
  getService: () => AdminRoleService,
): AdminRolePort {
  const read = new AdminRoleReadService(emFactory);
  return {
    async list() {
      return (await getService().list()).map(toAdminRoleRecord);
    },
    async getById(id) {
      return toAdminRoleRecord(await getService().getById(id));
    },
    findByCode: (code) => read.findByCode(code),
    async upsertByCode(input) {
      return toAdminRoleRecord(await getService().upsertByCode(input));
    },
    remove: (id) => getService().remove(id),
  };
}

/**
 * The contribution seam for deletion-protected role codes.
 *
 * Deliberately a plain object over the module-level set rather than anything
 * gated: `blog` registers its seeded code from a boot hook, and a gate would
 * both throw during composition and — worse — let an operator delete a
 * protected role by switching its owner off for a moment. See the port's
 * contract for the full reasoning.
 */
export function createSystemRoleCodePort(): SystemRoleCodePort {
  return {
    register: (code) => registerSystemRoleCode(code),
    list: () => listSystemRoleCodes(),
  };
}

export function toAdminRoleRecord(role: AdminRole): AdminRoleRecord {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    permissions: role.permissions ?? [],
    requiresTwoFactor: role.requiresTwoFactor,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
