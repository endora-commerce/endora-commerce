import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AuthSessionPort,
  type CustomerAuthenticationOrigin,
  type CustomerAuthenticationThrottlePort,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
// Feature 075, Phase C — a pure function over its argument, so it lives in the
// kernel rather than behind a gate that would answer 503 to "hash this string".
import { hashPassword } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { PasswordResetToken } from '../entities/password-reset-token.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { retireResetTokens, withdrawCustomerCredentials } from './credential-withdrawal.js';

/**
 * Password reset flow (FR-045 / T119).
 *
 *   - request: always returns success regardless of account existence
 *     (account-enumeration defense). Issues a sha256-hashed token with a
 *     short TTL (1 hour) and retires every earlier unconsumed token of the
 *     account, so only the newest e-mail's link works. The raw token is
 *     returned for the email body. Requests are counted per folded e-mail
 *     address in the customer authentication throttle, known account or
 *     not, and refused with 429 once one address has asked too often.
 *   - confirm: validates token (one-shot, expiry), rehashes the new password,
 *     marks the token and every other outstanding token of the account
 *     consumed, then ends all of the account's sessions and withdraws the
 *     logins it had begun.
 */

const TOKEN_TTL_HOURS = 1;

export class PasswordResetService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `auth`'s session surface: a reset ends the sessions the old password minted. */
    private readonly sessions: AuthSessionPort,
    private readonly auditLog?: AuditPort,
    /** `mfa`'s login port, resolved lazily and absent while `mfa` is. */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
    /** The customer authentication throttle; reset requests are counted in it. */
    private readonly throttle?: CustomerAuthenticationThrottlePort,
  ) {}

  /** Returns the raw token only when the email matched a real account. Caller emails it. */
  async requestReset(
    email: string,
    context: CustomerAuthenticationOrigin = {},
  ): Promise<{ rawToken: string | null }> {
    // Folded like every other lookup on this table (see `normalizeEmailAddress`).
    // An unmatched address is indistinguishable from an unknown one here — the
    // method answers `{ rawToken: null }` to both — so a case-sensitive compare
    // silently denied a reset to exactly the accounts that most needed one.
    const folded = normalizeEmailAddress(email);
    if (!this.throttle) return this.issueToken(folded);
    let issued: { rawToken: string | null; customerAccountId?: string } = { rawToken: null };
    // Every request is counted, for an address nobody holds as much as for a
    // real one: the check answers `ok: false` whatever it did, so the counter
    // is never reset by a request and only its window forgets it.
    await this.throttle.verify(
      {
        factor: 'password_reset',
        account: folded,
        ...(context.knownDevice !== undefined ? { knownDevice: context.knownDevice } : {}),
      },
      async () => {
        issued = await this.issueToken(folded);
        return issued.customerAccountId === undefined
          ? { ok: false }
          : { ok: false, customerAccountId: issued.customerAccountId };
      },
    );
    return { rawToken: issued.rawToken };
  }

  private async issueToken(
    folded: string,
  ): Promise<{ rawToken: string | null; customerAccountId?: string }> {
    // command-coverage-ignore: issues a short-TTL, one-shot reset token (rate-
    // limited, account-enumeration-safe); the actual password change is audited
    // at confirmReset (customer_account.password_reset).
    const em = this.emFactory();
    const customer = await em.findOne(CustomerAccount, {
      email: folded,
      deletedAt: null,
    });
    if (!customer) return { rawToken: null };

    const rawToken = randomBytes(32).toString('base64url');
    // Only the newest link works: an earlier e-mail that is still sitting in
    // the inbox stops being a way into the account the moment a new one is
    // asked for. Retired in the same flush that writes the new token.
    await retireResetTokens(em, customer.id);
    const token = em.create(PasswordResetToken, {
      customerAccountId: customer.id,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1_000),
    });
    await em.persist(token).flush();
    return { rawToken, customerAccountId: customer.id };
  }

  async confirmReset(rawToken: string, newPassword: string): Promise<void> {
    const em = this.emFactory();
    const token = await em.findOne(PasswordResetToken, { tokenHash: sha256Hex(rawToken) });
    if (!token || token.consumedAt || token.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Reset token is invalid or has expired.',
      );
    }
    const customer = await em.findOne(CustomerAccount, { id: token.customerAccountId });
    if (!customer) {
      throw new HttpError(
        400,
        ERROR_CODES.TOKEN_INVALID_OR_EXPIRED,
        'Associated account no longer exists.',
      );
    }
    customer.passwordHash = await hashPassword(newPassword);
    // Issue #222 — the holder proved control of the address and chose the
    // password themselves, so the account has one on record from here on. This
    // is also the one route into that state for an account federated sign-in
    // created: it never knew a current password to change.
    customer.passwordSetAt = new Date();
    token.consumedAt = new Date();
    await retireResetTokens(em, customer.id);
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'customer_account.password_reset',
        objectType: 'customer_account',
        objectId: customer.id,
        stateBefore: null,
        stateAfter: { via: 'reset_token' },
      });
    }
    await em.flush();
    // Whoever redeems a token holds no session, so there is none to keep.
    await withdrawCustomerCredentials(this.sessions, this.getMfaLoginPort?.(), customer.id);
  }

  /** Test-only — returns the latest unconsumed token id for probe tests. */
  async latestUnconsumedTokenId(): Promise<string | null> {
    const em = this.emFactory();
    const row = await em.findOne(
      PasswordResetToken,
      { consumedAt: null },
      { orderBy: { createdAt: 'desc' } },
    );
    return row?.id ?? null;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
