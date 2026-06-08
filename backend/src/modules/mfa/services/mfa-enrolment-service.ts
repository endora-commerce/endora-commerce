import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../../http/error-envelope.js';
import type { MfaSubjectRef } from '../../auth/services/mfa-login-port.js';
import { MfaEnrolment } from '../entities/mfa-enrolment.entity.js';
import { MfaRecoveryCode } from '../entities/mfa-recovery-code.entity.js';
import type { SecretCipher } from './secret-cipher.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from './recovery-codes.js';
import { generateSecret, verifyTotpStep } from './totp.js';

/**
 * TOTP enrolment lifecycle (feature 042): setup → activate (issue recovery
 * codes) → disable / regenerate, plus the second-factor verification used by
 * the login flow. The TOTP secret is encrypted at rest via `SecretCipher`;
 * recovery codes are stored only as SHA-256 hashes.
 */
export class MfaEnrolmentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cipher: SecretCipher,
  ) {}

  /** Begin (or restart) enrolment — creates a `pending` enrolment. */
  async setup(
    subject: MfaSubjectRef,
    accountLabel: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const em = this.emFactory();
    const active = await em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'active',
    });
    if (active) {
      throw new HttpError(409, 'MFA_ALREADY_ENROLLED', '2FA is already enabled for this account.');
    }
    // Replace any half-finished pending enrolment.
    const pendings = await em.find(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'pending',
    });
    for (const p of pendings) em.remove(p);

    const { secret, otpauthUri } = generateSecret(accountLabel);
    const enc = this.cipher.encrypt(secret);
    const enrolment = em.create(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'pending',
      secretCiphertext: enc.ciphertext,
      secretIv: enc.iv,
      secretAuthTag: enc.authTag,
    });
    em.persist(enrolment);
    await em.flush();
    return { secret, otpauthUri };
  }

  /** Confirm the pending enrolment with a live code; issue recovery codes. */
  async activate(
    subject: MfaSubjectRef,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const em = this.emFactory();
    const pending = await em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'pending',
    });
    if (!pending) {
      throw new HttpError(400, 'MFA_NO_PENDING_ENROLMENT', 'No pending 2FA setup to confirm.');
    }
    const secret = this.decryptSecret(pending);
    const step = verifyTotpStep(secret, code);
    if (step === null) {
      throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
    }
    pending.status = 'active';
    pending.confirmedAt = new Date();
    pending.lastAcceptedStep = String(step);

    const codes = generateRecoveryCodes();
    for (const c of codes) {
      em.persist(
        em.create(MfaRecoveryCode, {
          enrolmentId: pending.id,
          codeHash: hashRecoveryCode(c),
        }),
      );
    }
    await em.flush();
    return { recoveryCodes: codes };
  }

  /**
   * Admin reset — clear ALL enrolments (active + pending) for a subject.
   * Recovery codes cascade. Returns whether anything was removed (so a bulk
   * caller can report affected vs skipped). FR-025.
   */
  async reset(subject: MfaSubjectRef): Promise<boolean> {
    const em = this.emFactory();
    const affected = await em.nativeDelete(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
    });
    return affected > 0;
  }

  /** Disable 2FA for the subject (idempotent). Removes secret + recovery codes. */
  async disable(subject: MfaSubjectRef): Promise<void> {
    const em = this.emFactory();
    const active = await em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'active',
    });
    if (!active) return;
    await em.nativeDelete(MfaRecoveryCode, { enrolmentId: active.id });
    await em.removeAndFlush(active);
  }

  /** Invalidate the old recovery-code set and issue a fresh one. */
  async regenerateRecoveryCodes(
    subject: MfaSubjectRef,
  ): Promise<{ recoveryCodes: string[] }> {
    const em = this.emFactory();
    const active = await em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'active',
    });
    if (!active) {
      throw new HttpError(400, 'MFA_NO_ACTIVE_ENROLMENT', '2FA is not enabled for this account.');
    }
    await em.nativeDelete(MfaRecoveryCode, { enrolmentId: active.id });
    const codes = generateRecoveryCodes();
    for (const c of codes) {
      em.persist(
        em.create(MfaRecoveryCode, {
          enrolmentId: active.id,
          codeHash: hashRecoveryCode(c),
        }),
      );
    }
    await em.flush();
    return { recoveryCodes: codes };
  }

  async status(
    subject: MfaSubjectRef,
  ): Promise<{ totpActive: boolean; recoveryCodesRemaining: number }> {
    const em = this.emFactory();
    const active = await em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'active',
    });
    if (!active) return { totpActive: false, recoveryCodesRemaining: 0 };
    const recoveryCodesRemaining = await em.count(MfaRecoveryCode, {
      enrolmentId: active.id,
      usedAt: null,
    });
    return { totpActive: true, recoveryCodesRemaining };
  }

  /**
   * Verify a second factor (TOTP or recovery code) for an active enrolment.
   * A 6-digit input is treated as a TOTP code (with replay guard); anything
   * else is matched against unused recovery codes (single-use).
   */
  async verifySecondFactor(subject: MfaSubjectRef, code: string): Promise<boolean> {
    const em = this.emFactory();
    const active = await em.findOne(MfaEnrolment, {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      status: 'active',
    });
    if (!active) return false;

    const normalised = code.replace(/\s+/g, '');
    if (/^\d{6}$/.test(normalised)) {
      const secret = this.decryptSecret(active);
      const step = verifyTotpStep(secret, normalised);
      if (step === null) return false;
      // Replay guard — a step at or before the last accepted one is rejected.
      if (active.lastAcceptedStep != null && Number(active.lastAcceptedStep) >= step) {
        return false;
      }
      active.lastAcceptedStep = String(step);
      await em.flush();
      return true;
    }

    const rc = await em.findOne(MfaRecoveryCode, {
      enrolmentId: active.id,
      codeHash: hashRecoveryCode(normalised),
      usedAt: null,
    });
    if (!rc) return false;
    rc.usedAt = new Date();
    await em.flush();
    return true;
  }

  private decryptSecret(enrolment: MfaEnrolment): string {
    return this.cipher.decrypt({
      ciphertext: enrolment.secretCiphertext,
      iv: enrolment.secretIv,
      authTag: enrolment.secretAuthTag,
    });
  }
}
