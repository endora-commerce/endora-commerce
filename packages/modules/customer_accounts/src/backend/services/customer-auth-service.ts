import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AuthSessionPort,
  type CustomerChangePasswordContext,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import {
  ownCustomerSessionId,
  retireResetTokens,
  withdrawCustomerCredentials,
} from './credential-withdrawal.js';

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
 *   401 CURRENT_PASSWORD_INVALID otherwise; rehash + persist, then end every
 *   other session of the account, retire its outstanding reset tokens and
 *   withdraw the logins it had begun.
 *
 * Feature 075, Phase C — the three things this service needed from `auth` are
 * now named where they belong rather than in `auth`'s directory. Sessions come
 * over {@link AuthSessionPort}, so a session is minted or destroyed through the
 * surface `auth` publishes and never through its `Session` entity. The MFA seam
 * is `auth`'s *shape* implemented by `mfa`, published in `@endora-commerce/contracts` so
 * this service depends on neither module for it. And the password hash is a
 * pure function that moved to `src/kernel/crypto/`: an operator switching a
 * module off must not make "hash this string" answer 503.
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
    private readonly sessionService: AuthSessionPort,
    /** Lazily resolved so composition can late-bind the MFA module. */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
    private readonly auditLog?: AuditPort,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
    salesChannelId?: string | null;
  }): Promise<CustomerLoginOutcome> {
    const em = this.emFactory();
    // Folded, because the row is. `=` on `text` is case-sensitive in Postgres,
    // so comparing the address exactly as typed refused every account whose
    // holder had capitalised anything — with the generic error above, which
    // says nothing they or support could act on.
    const found = await em.findOne(CustomerAccount, {
      email: normalizeEmailAddress(input.email),
    });
    const customer = found !== null && !found.deletedAt ? found : null;
    // Verified whether or not there is an account to verify against: an
    // address nobody holds must not be refused sooner than a wrong password.
    const ok = await verifyPasswordOrDummy(customer?.passwordHash, input.password);
    if (!customer || !ok) {
      // Generic error to avoid account enumeration.
      throw new HttpError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
    }
    // Feature 040 — a blocked account cannot log in (FR-012/FR-016). The
    // distinct error lets the storefront show a clear "account blocked" message.
    // It is given only to somebody who has the password: answered before the
    // password is looked at, it told anybody which addresses have an account.
    if (customer.blockedAt) {
      throw new HttpError(
        403,
        ERROR_CODES.ACCOUNT_BLOCKED,
        'This account has been blocked. Please contact support.',
      );
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
    context: CustomerChangePasswordContext = {},
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
    const passwordHash = await hashPassword(newPassword);
    // Which session is the caller's is worked out before anything is written.
    const keep = await ownCustomerSessionId(
      this.sessionService,
      customer.id,
      context.sessionCookieValue,
    );
    customer.passwordHash = passwordHash;
    await retireResetTokens(em, customer.id);
    // Issue #222 — the holder proved the current password and chose the new
    // one, so the account has a password on record whatever it had before.
    customer.passwordSetAt = new Date();
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
    await withdrawCustomerCredentials(
      this.sessionService,
      this.getMfaLoginPort?.(),
      customer.id,
      keep,
    );
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.destroySession(sessionId);
  }
}
