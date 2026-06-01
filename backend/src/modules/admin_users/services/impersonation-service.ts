import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SessionService } from '../../auth/services/session-service.js';
import { AdminUser } from '../entities/admin-user.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

/**
 * ImpersonationService (T189). Implements the switch-user pattern:
 *   - start(adminSessionId, customerAccountId, reason?) — destroys (no:
 *     DOES NOT destroy) the admin session, mints a new "impersonation"
 *     session whose customer scope is the target customer AND whose
 *     impersonatorAdminUserId is the original admin. The original admin
 *     session id is returned as a "shadow" cookie so end can restore it.
 *   - end(impersonationSessionId, adminShadowSessionId) — destroys the
 *     impersonation session, returns the (still alive) admin session id.
 *
 * AuditLogService.record is called BEFORE the cookie is minted (T179
 * "audit-before-cookie") so a partial failure can never leave an
 * impersonation cookie without an audit row.
 */

export interface ImpersonationStartResult {
  impersonationSessionId: string;
  impersonationCookieValue: string;
  impersonationExpiresAt: Date;
  adminShadowSessionCookieValue: string;
  impersonatedCustomerAccount: CustomerAccount;
}

export interface ImpersonationEndResult {
  adminSessionCookieValue: string;
  adminSessionExpiresAt: Date;
}

export class ImpersonationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly sessionService: SessionService,
    private readonly auditLog: AuditLogService,
  ) {}

  async start(input: {
    adminUserId: string;
    /** Raw admin session cookie value — must be preserved as the shadow. */
    adminSessionCookieValue: string;
    customerAccountId: string;
    /**
     * Feature 040 — optional: standalone (org-less) customers have no
     * Organization. When provided it scopes the target lookup; when omitted
     * the target is found by id alone.
     */
    organizationId?: string | null;
    reason?: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<ImpersonationStartResult> {
    const em = this.emFactory();

    const admin = await em.findOne(AdminUser, { id: input.adminUserId, deletedAt: null });
    if (!admin) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    const target = await em.findOne(CustomerAccount, {
      id: input.customerAccountId,
      ...(input.organizationId != null ? { organizationId: input.organizationId } : {}),
      deletedAt: null,
    });
    if (!target) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Target customer not found.');
    }

    // Audit FIRST — partial failure leaves no dangling cookie.
    await this.auditLog.record({
      actorAdminUserId: admin.id,
      impersonatedCustomerAccountId: target.id,
      action: 'impersonation.start',
      objectType: 'customer_account',
      objectId: target.id,
      stateBefore: null,
      stateAfter: { reason: input.reason ?? null, organizationId: input.organizationId ?? null },
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });

    const session = await this.sessionService.createSession({
      kind: 'impersonation',
      customerAccountId: target.id,
      impersonatorAdminUserId: admin.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    return {
      impersonationSessionId: session.session.id,
      impersonationCookieValue: session.cookieValue,
      impersonationExpiresAt: session.expiresAt,
      adminShadowSessionCookieValue: input.adminSessionCookieValue,
      impersonatedCustomerAccount: target,
    };
  }

  async end(input: {
    impersonationSessionCookieValue: string;
    adminShadowCookieValue: string;
    ip?: string;
    userAgent?: string;
    requestId?: string;
  }): Promise<ImpersonationEndResult> {
    // Resolve current impersonation session to get the admin id for the audit
    // entry; then destroy it, then audit, then return the shadow as the new
    // session cookie.
    const resolved = await this.sessionService.loadSession(
      input.impersonationSessionCookieValue,
    );
    if (
      !resolved ||
      resolved.kind !== 'impersonation' ||
      !resolved.session.impersonatorAdminUserId ||
      !resolved.session.customerAccountId
    ) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'No active impersonation session.');
    }
    const adminId = resolved.session.impersonatorAdminUserId;
    const customerId = resolved.session.customerAccountId;

    // Destroy impersonation session — single use.
    await this.sessionService.destroySession(resolved.session.id);

    await this.auditLog.record({
      actorAdminUserId: adminId,
      impersonatedCustomerAccountId: customerId,
      action: 'impersonation.end',
      objectType: 'customer_account',
      objectId: customerId,
      stateBefore: null,
      stateAfter: null,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });

    // The shadow cookie is the unchanged original admin session — verify it
    // still resolves before handing it back. If somehow the admin session
    // expired during impersonation, return 401 so the client must re-login.
    const shadow = await this.sessionService.loadSession(input.adminShadowCookieValue);
    if (!shadow || shadow.kind !== 'admin') {
      throw new HttpError(
        401,
        ERROR_CODES.UNAUTHORIZED,
        'Original admin session is no longer valid; please log in again.',
      );
    }

    return {
      adminSessionCookieValue: input.adminShadowCookieValue,
      adminSessionExpiresAt: shadow.session.expiresAt,
    };
  }
}
