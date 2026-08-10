import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword, verifyPassword } from '../../auth/services/password-hasher.js';
import type { SessionService } from '../../auth/services/session-service.js';
import type { MfaLoginPort } from '../../auth/services/mfa-login-port.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

/**
 * Customer-side auth flows (T119; two-step login added in feature 042).
 *
 * - login: email + password → first factor. When an `MfaLoginPort` is injected
 *   and the account has active 2FA (or 2FA is enforced for the scope), login
 *   returns an `mfaRequired` / `mfaSetupRequired` outcome WITHOUT a session;
 *   the second step is completed by the MFA module's verify endpoint. When no
 *   port is present (or it returns `proceed`), login issues the session exactly
 *   as before (password-only fallback, FR-033).
 * - logout: destroy session.
 * - changePassword: argon2 verify of `currentPassword`; reject with
 *   401 CURRENT_PASSWORD_INVALID otherwise; rehash + persist.
 */
export interface LoginResult {
  customerAccount: CustomerAccount;
  /** Value to put into the Set-Cookie header. */
  sessionCookieValue: string;
  sessionExpiresAt: Date;
}

/** Discriminated outcome of the first login step (feature 042). */
export type CustomerLoginOutcome =
  | ({ status: 'authenticated' } & LoginResult)
  | { status: 'mfaRequired'; challengeId: string }
  | { status: 'mfaSetupRequired'; setupTicket: string };

export class CustomerAuthService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly sessionService: SessionService,
    /** Lazily resolved so composition can late-bind the MFA module. */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
    private readonly auditLog?: AuditLogService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
    salesChannelId?: string | null;
  }): Promise<CustomerLoginOutcome> {
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, { email: input.email });
    if (!customer) {
      // Generic error to avoid account enumeration.
      throw new HttpError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
    }
    if (customer.deletedAt) {
      throw new HttpError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
    }
    // Feature 040 — a blocked account cannot log in (FR-012/FR-016). The
    // distinct error lets the storefront show a clear "account blocked" message.
    if (customer.blockedAt) {
      throw new HttpError(
        403,
        ERROR_CODES.ACCOUNT_BLOCKED,
        'This account has been blocked. Please contact support.',
      );
    }
    const ok = await verifyPassword(customer.passwordHash, input.password);
    if (!ok) {
      throw new HttpError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
    }

    // Second factor (feature 042). No session is issued until it succeeds.
    const mfaPort = this.getMfaLoginPort?.();
    if (mfaPort) {
      const decision = await mfaPort.beginLogin(
        { subjectType: 'customer', subjectId: customer.id },
        {
          salesChannelId: input.salesChannelId ?? null,
          organizationId: customer.organizationId ?? null,
        },
      );
      if (decision.kind === 'challenge') {
        return { status: 'mfaRequired', challengeId: decision.challengeId };
      }
      if (decision.kind === 'setup') {
        return { status: 'mfaSetupRequired', setupTicket: decision.setupTicket };
      }
    }

    const session = await this.sessionService.createSession({
      kind: 'customer',
      customerAccountId: customer.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    // command-coverage-ignore: stamps lastLoginAt for the session — high-volume
    // auth bookkeeping (session lifecycle is owned by SessionService), not an
    // audited domain-state mutation.
    customer.lastLoginAt = new Date();
    await em.flush();

    return {
      status: 'authenticated',
      customerAccount: customer,
      sessionCookieValue: session.cookieValue,
      sessionExpiresAt: session.expiresAt,
    };
  }

  async changePassword(
    customerAccountId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, { id: customerAccountId });
    if (!customer) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
    const ok = await verifyPassword(customer.passwordHash, currentPassword);
    if (!ok) {
      throw new HttpError(
        401,
        ERROR_CODES.CURRENT_PASSWORD_INVALID,
        'Current password is incorrect.',
      );
    }
    customer.passwordHash = await hashPassword(newPassword);
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'customer_account.change_password',
        objectType: 'customer_account',
        objectId: customer.id,
        stateBefore: null,
        stateAfter: { via: 'self_service' },
      });
    }
    await em.flush();
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.destroySession(sessionId);
  }
}
