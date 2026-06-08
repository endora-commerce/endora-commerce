import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MfaLoginContext,
  MfaLoginDecision,
  MfaLoginPort,
  MfaSubjectRef,
} from '../../auth/services/mfa-login-port.js';
import { MfaEnrolment } from '../entities/mfa-enrolment.entity.js';
import type { ChallengeStore } from './challenge-store.js';
import type { MfaPolicyResolver } from './mfa-policy-resolver.js';
import type { MfaEnrolmentService } from './mfa-enrolment-service.js';

/** Result of completing the second step. */
export type MfaVerifyResult =
  | { ok: true; subject: MfaSubjectRef }
  | { ok: false; error: 'invalid_challenge' | 'invalid_code' | 'locked' };

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
    private readonly enrolmentService?: MfaEnrolmentService,
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

  async isTwoFactorActive(subject: MfaSubjectRef): Promise<boolean> {
    return (await this.findActiveEnrolment(subject)) !== null;
  }

  /**
   * Complete the second step: verify the code against the challenge's subject.
   * On failure, the attempt budget is decremented and the challenge burned when
   * exhausted. On success the challenge is consumed and the subject returned so
   * the route can mint the session.
   */
  async verifyChallenge(challengeId: string, code: string): Promise<MfaVerifyResult> {
    if (!this.enrolmentService) return { ok: false, error: 'invalid_code' };
    const challenge = await this.challengeStore.getChallenge(challengeId);
    if (!challenge) return { ok: false, error: 'invalid_challenge' };

    const subject: MfaSubjectRef = {
      subjectType: challenge.subjectType,
      subjectId: challenge.subjectId,
    };
    const ok = await this.enrolmentService.verifySecondFactor(subject, code);
    if (!ok) {
      const remaining = await this.challengeStore.recordFailedAttempt(challengeId);
      return { ok: false, error: remaining <= 0 ? 'locked' : 'invalid_code' };
    }
    await this.challengeStore.consumeChallenge(challengeId);
    return { ok: true, subject };
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
