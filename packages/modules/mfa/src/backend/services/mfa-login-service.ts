import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminAuthenticationOrigin,
  MfaLoginContext,
  MfaLoginDecision,
  MfaLoginPort,
  MfaSubjectRef,
} from '@endora-commerce/contracts';
import { MfaEnrolment } from '../entities/mfa-enrolment.entity.js';
import type { ChallengeStore } from './challenge-store.js';
import type { MfaPolicyResolver } from './mfa-policy-resolver.js';
import type { SecondFactorVerifier } from './second-factor-verifier.js';

/** Result of completing the second step. */
export type MfaVerifyResult =
  | { ok: true; subject: MfaSubjectRef; factor: 'totp' | 'recovery' }
  | { ok: false; error: 'invalid_challenge' }
  | { ok: false; error: 'invalid_code' | 'locked'; subject: MfaSubjectRef };

/**
 * Orchestrates the post-first-factor MFA decision (feature 042, R4).
 * Implements the `MfaLoginPort` consumed by the login services.
 *
 * The second-step verification (`verifySecondFactor`) and the enrolment
 * endpoints arrive with User Story 1; this Phase-2 slice provides the
 * `beginLogin` decision so login can already return the two-step union while
 * behaving as password-only until a subject actually enrols or enforcement is
 * switched on.
 */
export class MfaLoginService implements MfaLoginPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly challengeStore: ChallengeStore,
    private readonly policyResolver: MfaPolicyResolver,
    /** Present once the cipher key is configured; required by `verifyChallenge`. */
    private readonly verifySecondFactor?: SecondFactorVerifier,
  ) {}

  async beginLogin(
    subject: MfaSubjectRef,
    ctx: MfaLoginContext,
  ): Promise<MfaLoginDecision> {
    const active = await this.findActiveEnrolment(subject);
    if (active) {
      const challengeId = await this.challengeStore.issueChallenge({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        salesChannelId: ctx.salesChannelId,
      });
      return { kind: 'challenge', challengeId };
    }

    const policy = await this.policyResolver.resolve(subject, ctx);
    if (policy.totpEnforced) {
      const setupTicket = await this.challengeStore.issueSetupTicket({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        salesChannelId: ctx.salesChannelId,
      });
      return { kind: 'setup', setupTicket };
    }

    return { kind: 'proceed' };
  }

  async invalidatePending(subject: MfaSubjectRef): Promise<void> {
    await this.challengeStore.invalidateSubject(subject.subjectType, subject.subjectId);
  }

  /**
   * Whether the subject currently has an active TOTP enrolment.
   *
   * D-96.4 — no longer part of `MfaLoginPort`: it had no consumer in `src/`,
   * and the port answers exactly one question now. Kept on the service because
   * it is a fact about this module's own table.
   */
  async isTwoFactorActive(subject: MfaSubjectRef): Promise<boolean> {
    return (await this.findActiveEnrolment(subject)) !== null;
  }

  /**
   * Complete the second step: verify the code against the challenge's subject.
   * An attempt is taken from the challenge's budget before the code is checked,
   * and the challenge is burned when the last one fails. On success the challenge is consumed and the subject returned so
   * the route can mint the session.
   *
   * An administrator's code is checked inside the account's authentication
   * throttle, which rejects with 429 before the code is looked at while a delay
   * is running — so a refused attempt spends none of the challenge's budget.
   */
  async verifyChallenge(
    challengeId: string,
    code: string,
    context?: AdminAuthenticationOrigin,
  ): Promise<MfaVerifyResult> {
    if (!this.verifySecondFactor) return { ok: false, error: 'invalid_challenge' };
    const challenge = await this.challengeStore.getChallenge(challengeId);
    if (!challenge) return { ok: false, error: 'invalid_challenge' };

    const subject: MfaSubjectRef = {
      subjectType: challenge.subjectType,
      subjectId: challenge.subjectId,
    };
    // The attempt is taken before the code is looked at, so codes sent at the
    // same time cannot all be checked against one unspent budget.
    const remaining = await this.challengeStore.takeAttempt(challengeId);
    // Gone between the read above and the take — consumed by a request that
    // completed it, expired, or withdrawn: start over, not "too many attempts".
    if (remaining === null) return { ok: false, error: 'invalid_challenge' };
    if (remaining < 0) return { ok: false, error: 'locked', subject };
    let verified: Awaited<ReturnType<SecondFactorVerifier>>;
    try {
      verified = await this.verifySecondFactor(subject, code, context);
    } catch (error) {
      // Refused before the code was checked — the throttle's 429, a store that
      // did not answer. Nothing was learned from it, so it costs nothing.
      await this.challengeStore.returnAttempt(challengeId);
      throw error;
    }
    if (!verified.ok) {
      if (remaining === 0) await this.challengeStore.consumeChallenge(challengeId);
      return { ok: false, error: remaining === 0 ? 'locked' : 'invalid_code', subject };
    }
    await this.challengeStore.consumeChallenge(challengeId);
    return { ok: true, subject, factor: verified.factor ?? 'totp' };
  }

  private async findActiveEnrolment(
    subject: MfaSubjectRef,
  ): Promise<MfaEnrolment | null> {
    const em = this.emFactory();
    return em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'active',
    });
  }
}
