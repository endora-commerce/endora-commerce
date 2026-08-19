import { createHash, randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, normalizeEmailAddress } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
// Feature 075, Phase C — a pure function over its argument, so it lives in the
// kernel rather than behind a gate that would answer 503 to "hash this string".
import { hashPassword } from '../../../kernel/crypto/password-hasher.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { PasswordResetToken } from '../entities/password-reset-token.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

/**
 * Password reset flow (FR-045 / T119).
 *
 *   - request: always returns success regardless of account existence
 *     (account-enumeration defense). Issues a sha256-hashed token with a
 *     short TTL (1 hour). The raw token is returned for the email body.
 *   - confirm: validates token (one-shot, expiry), rehashes the new password,
 *     marks the token consumed.
 */

const TOKEN_TTL_HOURS = 1;

export class PasswordResetService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  /** Returns the raw token only when the email matched a real account. Caller emails it. */
  async requestReset(email: string): Promise<{ rawToken: string | null }> {
    // command-coverage-ignore: issues a short-TTL, one-shot reset token (rate-
    // limited, account-enumeration-safe); the actual password change is audited
    // at confirmReset (customer_account.password_reset).
    const em = this.emFactory();
    // Folded like every other lookup on this table (see `normalizeEmailAddress`).
    // An unmatched address is indistinguishable from an unknown one here — the
    // method answers `{ rawToken: null }` to both — so a case-sensitive compare
    // silently denied a reset to exactly the accounts that most needed one.
    const customer = await em.findOne(CustomerAccount, {
      email: normalizeEmailAddress(email),
      deletedAt: null,
    });
    if (!customer) return { rawToken: null };

    const rawToken = randomBytes(32).toString('base64url');
    const token = em.create(PasswordResetToken, {
      customerAccountId: customer.id,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1_000),
    });
    await em.persistAndFlush(token);
    return { rawToken };
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
