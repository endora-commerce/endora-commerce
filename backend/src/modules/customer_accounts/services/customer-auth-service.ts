import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { hashPassword, verifyPassword } from '../../auth/services/password-hasher.js';
import type { SessionService } from '../../auth/services/session-service.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * Customer-side auth flows (T119).
 *
 * - login: email + password → opaque session cookie (via SessionService).
 *   2FA is not exercised in US2 (covered by T030 enablement and the
 *   organizations.contract.md 2FA paths — those tests ship in US2 extension).
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

export class CustomerAuthService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly sessionService: SessionService,
  ) {}

  async login(input: { email: string; password: string; ip?: string; userAgent?: string }): Promise<LoginResult> {
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

    const session = await this.sessionService.createSession({
      kind: 'customer',
      customerAccountId: customer.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });

    customer.lastLoginAt = new Date();
    await em.flush();

    return {
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
    await em.flush();
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.destroySession(sessionId);
  }
}
