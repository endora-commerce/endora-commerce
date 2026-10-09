import type {
  AdminAuthenticationOrigin,
  AdminAuthenticationThrottlePort,
  MfaSubjectRef,
} from '@endora-commerce/contracts';

/** What a second-factor check answers: whether it matched, and which factor did. */
export interface SecondFactorResult {
  ok: boolean;
  factor?: 'totp' | 'recovery';
}

/**
 * Verify a TOTP or recovery code for a subject. `context` says where the
 * request came from, when the caller knows.
 */
export type SecondFactorVerifier = (
  subject: MfaSubjectRef,
  code: string,
  context?: AdminAuthenticationOrigin,
) => Promise<SecondFactorResult>;

/**
 * The second-factor check every route in this module goes through.
 *
 * For an administrator it runs inside `admin_users`' authentication throttle,
 * keyed by the administrator id. A six-digit code is a small space, and the
 * five-code budget of one sign-in challenge did not bound guessing on its own:
 * a new challenge, with a new budget, costs one more password request. While a
 * delay is running the call rejects with 429 `ADMIN_AUTHENTICATION_THROTTLED`
 * and the code is not looked at.
 *
 * A customer's check is passed straight through, as before.
 */
export function createSecondFactorVerifier(
  verify: (subject: MfaSubjectRef, code: string) => Promise<SecondFactorResult>,
  adminThrottle: Pick<AdminAuthenticationThrottlePort, 'verify'>,
): SecondFactorVerifier {
  return async (subject, code, context) => {
    if (subject.subjectType !== 'admin') return verify(subject, code);
    let result: SecondFactorResult = { ok: false };
    await adminThrottle.verify(
      {
        factor: 'second_factor',
        account: subject.subjectId,
        ...(context?.ip !== undefined ? { ip: context.ip } : {}),
        ...(context?.knownDevice !== undefined ? { knownDevice: context.knownDevice } : {}),
      },
      async () => {
        result = await verify(subject, code);
        return { ok: result.ok, adminUserId: subject.subjectId };
      },
    );
    return result;
  };
}
