import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AuthSessionPort,
  type CustomerAuthenticationThrottlePort,
  type CustomerChangePasswordContext,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort, SalesChannelAccessPort } from '@endora-commerce/platform/kernel';
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
  /**
   * The known-device cookie value to set beside the session, or `null` when
   * none is to be set.
   */
  knownDevice: string | null;
}

/** Discriminated outcome of the first login step (feature 042). */
export type CustomerLoginOutcome =
  | ({ status: 'authenticated' } & LoginResult)
  | { status: 'mfaRequired'; challengeId: string }
  | { status: 'mfaSetupRequired'; setupTicket: string };

/**
 * Issue #652 (D-292) — how a sign-in fills an account's unknown preferred
 * language: `captureIfUnset` is `customerAccountPreferencePort`'s, and
 * `onFailure` is told about a capture that threw. A capture never fails the
 * sign-in it rides on.
 */
export interface SignInLanguageCapture {
  captureIfUnset(customerAccountId: string, preferredLanguage: string): Promise<void>;
  onFailure(err: unknown, customerAccountId: string): void;
}

export class CustomerAuthService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly sessionService: AuthSessionPort,
    /** Lazily resolved so composition can late-bind the MFA module. */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
    private readonly auditLog?: AuditPort,
    /**
     * The customer authentication throttle. Every password comparison at
     * sign-in runs inside it, keyed by the folded e-mail address — whether or
     * not an account has it — so repeated wrong passwords are refused with 429
     * `CUSTOMER_AUTHENTICATION_THROTTLED` before anything is looked up.
     */
    private readonly throttle?: CustomerAuthenticationThrottlePort,
    /**
     * Feature 154 — the kernel's sales-channel access rule. The sign-in route
     * is open to the access step (a visitor of a closed store has to be able
     * to sign in), so the rule is decided here: after the password and the
     * blocked check, before a second factor is started or a session issued.
     * Optional so a unit composition without it keeps working.
     */
    private readonly channelAccess?: Pick<SalesChannelAccessPort, 'assertCustomerMayUse'>,
    /**
     * Issue #652 (D-292) — the preferred-language capture. Optional so a unit
     * composition without it keeps working; absent, nothing is captured.
     */
    private readonly languageCapture?: SignInLanguageCapture,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
    salesChannelId?: string | null;
    knownDevice?: string;
    language?: string | null;
  }): Promise<CustomerLoginOutcome> {
    const em = this.emFactory();
    // Folded, because the row is. `=` on `text` is case-sensitive in Postgres,
    // so comparing the address exactly as typed refused every account whose
    // holder had capitalised anything — with the generic error above, which
    // says nothing they or support could act on.
    const email = normalizeEmailAddress(input.email);
    const lookup: { customer: CustomerAccount | null } = { customer: null };
    const compare = async (): Promise<{ ok: boolean; customerAccountId?: string }> => {
      const found = await em.findOne(CustomerAccount, { email });
      const candidate = found !== null && !found.deletedAt ? found : null;
      lookup.customer = candidate;
      // Verified whether or not there is an account to verify against: an
      // address nobody holds must not be refused sooner than a wrong password.
      const matched = await verifyPasswordOrDummy(candidate?.passwordHash, input.password);
      return candidate === null
        ? { ok: false }
        : { ok: matched, customerAccountId: candidate.id };
    };
    // An address belonging to nobody is throttled exactly like a real one, and
    // while a delay runs neither the lookup nor the comparison happens.
    const ok = this.throttle
      ? await this.throttle.verify(
          {
            factor: 'password',
            account: email,
            ...(input.knownDevice !== undefined ? { knownDevice: input.knownDevice } : {}),
          },
          compare,
        )
      : (await compare()).ok;
    const customer = lookup.customer;
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

    // Feature 154 — the account may only sign in on a sales channel its
    // Organization is assigned to. Decided after the password, so somebody
    // without it learns nothing about assignments, and before anything is
    // issued: a refused sign-in starts no second factor, creates no session and
    // leaves `lastLoginAt` alone. No channel (a caller outside a request) is
    // refused rather than waved through.
    if (this.channelAccess) {
      if (!input.salesChannelId) {
        throw new HttpError(
          403,
          ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
          'This account does not have access to this store.',
        );
      }
      await this.channelAccess.assertCustomerMayUse(
        customer.organizationId ?? null,
        input.salesChannelId,
      );
    }

    // Issue #652 (D-292) — an account that has no preferred language yet takes
    // the sign-in's. Here, after every refusal above and before the second
    // factor, so a sign-in that goes on to a code captures too and a refused
    // one captures nothing. A known language is never overwritten: only the
    // owner's explicit choice does that.
    await this.capturePreferredLanguage(customer, input.language);

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
      // The sign-in is complete here — no second factor was asked for — so
      // this device is now one the account has been used from.
      knownDevice: this.throttle ? await this.throttle.issueKnownDevice(customer.id) : null,
    };
  }

  private async capturePreferredLanguage(
    customer: CustomerAccount,
    language: string | null | undefined,
  ): Promise<void> {
    const capture = this.languageCapture;
    if (!capture || !language || customer.preferredLanguage != null) return;
    try {
      await capture.captureIfUnset(customer.id, language);
    } catch (err) {
      capture.onFailure(err, customer.id);
    }
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
