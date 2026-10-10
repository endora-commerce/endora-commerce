import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuthSessionPort, MfaLoginPort } from '@endora-commerce/contracts';
import { PasswordResetToken } from '../entities/password-reset-token.entity.js';

/**
 * What a customer's password change and password reset share: withdrawing
 * everything the old password had already been exchanged for.
 */

/**
 * Mark every reset token still outstanding for the account as consumed. The
 * caller flushes, so the tokens are retired in the same write as the password.
 */
export async function retireResetTokens(em: EntityManager, customerAccountId: string): Promise<void> {
  const consumedAt = new Date();
  const outstanding = await em.find(PasswordResetToken, { customerAccountId, consumedAt: null });
  for (const token of outstanding) token.consumedAt = consumedAt;
}

/**
 * The id of the session `cookieValue` resolves to, when it is a session of
 * `customerAccountId` — otherwise nothing. `loadSession` checks the token, so a
 * cookie that merely names another session's id spares nothing.
 */
export async function ownCustomerSessionId(
  sessions: AuthSessionPort,
  customerAccountId: string,
  cookieValue: string | undefined,
): Promise<string | undefined> {
  if (!cookieValue) return undefined;
  const resolved = await sessions.loadSession(cookieValue);
  if (!resolved || resolved.kind === 'admin') return undefined;
  if (resolved.session.customerAccountId !== customerAccountId) return undefined;
  return resolved.session.id;
}

/**
 * End the account's sessions (all, or all but `keepSessionId`) and withdraw
 * the logins it had begun and not finished.
 *
 * **Called after the flush, never before**, for the reason `admin_users`'
 * `AdminUserService` gives: once the new password is committed nothing new can
 * be obtained with the old one, so everything obtained earlier exists by now.
 * No `catch`: a change that reported success while the old sessions kept
 * answering would be reporting something false.
 */
export async function withdrawCustomerCredentials(
  sessions: AuthSessionPort,
  mfaLoginPort: MfaLoginPort | undefined,
  customerAccountId: string,
  keepSessionId?: string,
): Promise<void> {
  await sessions.destroyAllForCustomer(
    customerAccountId,
    keepSessionId === undefined ? undefined : { exceptSessionId: keepSessionId },
  );
  await mfaLoginPort?.invalidatePending({ subjectType: 'customer', subjectId: customerAccountId });
}
