import type { AuthSessionPort, MfaSubjectRef } from '@endora-commerce/contracts';
import type { ChallengeStore } from './challenge-store.js';

/**
 * Withdraw what a subject obtained while a second factor stood, once that
 * factor has been removed: their sessions (all, or all but the one the request
 * was made from) and the logins they had begun and not finished.
 *
 * A session established with a second factor must not outlive the removal of
 * that factor on another device. Disabling one's own factor keeps the calling
 * session — the caller has just re-authenticated in it — and ends the others;
 * a reset performed by an administrator passes no cookie and ends them all.
 * Enrolling a factor withdraws nothing.
 *
 * **Called after the removal is persisted, never before**: a sign-in between
 * the two steps would otherwise keep a session nothing revokes. Sessions are
 * `auth`'s, reached through its published port only.
 */
export type FactorWithdrawal = (
  subject: MfaSubjectRef,
  /** The raw session cookie of the request, when the subject made it. */
  callerCookieValue?: string | undefined,
) => Promise<void>;

export function createFactorWithdrawal(
  sessions: AuthSessionPort,
  challengeStore: ChallengeStore,
): FactorWithdrawal {
  return async (subject, callerCookieValue) => {
    const isAdmin = subject.subjectType === 'admin';
    // The token is checked by `loadSession`, and the session counts only when
    // it belongs to this very subject, so a cookie naming somebody else's
    // session spares nothing.
    const resolved = callerCookieValue ? await sessions.loadSession(callerCookieValue) : null;
    const owner = !resolved
      ? null
      : isAdmin
        ? resolved.kind === 'admin'
          ? resolved.session.adminUserId
          : null
        : resolved.kind === 'admin'
          ? null
          : resolved.session.customerAccountId;
    const options =
      resolved && owner === subject.subjectId ? { exceptSessionId: resolved.session.id } : undefined;
    if (isAdmin) await sessions.destroyAllForAdmin(subject.subjectId, options);
    else await sessions.destroyAllForCustomer(subject.subjectId, options);
    await challengeStore.invalidateSubject(subject.subjectType, subject.subjectId);
  };
}
