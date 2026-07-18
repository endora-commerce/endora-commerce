import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

/**
 * RoleService (T174).
 *
 * Members management on the buyer side. Two safety guards:
 *   - CANNOT_REMOVE_LAST_ADMIN — DELETE on the only `organization_admin`
 *     member of an org returns 409.
 *   - CANNOT_DEMOTE_LAST_ADMIN — PATCH /role downgrading the only
 *     `organization_admin` returns 409.
 */
export class RoleService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'customer_account',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  async listMembers(organizationId: string): Promise<CustomerAccount[]> {
    const em = this.emFactory();
    return em.find(
      CustomerAccount,
      { organizationId, deletedAt: null },
      { orderBy: { role: 'asc', createdAt: 'asc' } },
    );
  }

  async changeRole(
    organizationId: string,
    targetCustomerAccountId: string,
    newRole: 'organization_admin' | 'regular_user',
  ): Promise<CustomerAccount> {
    const em = this.emFactory();
    const target = await em.findOne(CustomerAccount, {
      id: targetCustomerAccountId,
      organizationId,
      deletedAt: null,
    });
    if (!target) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
    }
    if (
      target.role === 'organization_admin' &&
      newRole === 'regular_user' &&
      (await this.#countAdmins(em, organizationId)) === 1
    ) {
      throw new HttpError(
        409,
        ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN,
        'Cannot demote the only organization admin.',
      );
    }
    const previousRole = target.role;
    target.role = newRole;
    this.#audit(em, 'customer_account.change_role', target.id, { role: previousRole }, { role: newRole });
    await em.flush();
    return target;
  }

  async removeMember(organizationId: string, targetCustomerAccountId: string): Promise<void> {
    const em = this.emFactory();
    const target = await em.findOne(CustomerAccount, {
      id: targetCustomerAccountId,
      organizationId,
      deletedAt: null,
    });
    if (!target) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Member not found.');
    }
    if (
      target.role === 'organization_admin' &&
      (await this.#countAdmins(em, organizationId)) === 1
    ) {
      throw new HttpError(
        409,
        ERROR_CODES.CANNOT_REMOVE_LAST_ADMIN,
        'Cannot remove the only organization admin.',
      );
    }
    target.deletedAt = new Date();
    this.#audit(em, 'customer_account.remove_member', target.id, { role: target.role }, null);
    await em.flush();
  }

  async #countAdmins(em: EntityManager, organizationId: string): Promise<number> {
    return em.count(CustomerAccount, {
      organizationId,
      role: 'organization_admin',
      deletedAt: null,
    });
  }
}
