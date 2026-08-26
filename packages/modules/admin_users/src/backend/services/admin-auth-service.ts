import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AuthSessionPort,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { hashPassword, verifyPassword } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../entities/admin-user.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/**
 * AdminAuthService (T186; two-step login added in feature 042). login →
 * first factor; when an `MfaLoginPort` is injected and the admin has active
 * 2FA (or 2FA is enforced) it returns `mfaRequired` / `mfaSetupRequired`
 * without a session. Absent port ⇒ password-only (FR-033).
 */
export interface AdminLoginResult {
  adminUser: AdminUser;
  sessionCookieValue: string;
  sessionExpiresAt: Date;
}

/** Discriminated outcome of the first admin login step (feature 042). */
export type AdminLoginOutcome =
  | ({ status: 'authenticated' } & AdminLoginResult)
  | { status: 'mfaRequired'; challengeId: string }
  | { status: 'mfaSetupRequired'; setupTicket: string };

export class AdminAuthService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `auth`'s published session surface (feature 075, Phase C). */
    private readonly sessionPort: AuthSessionPort,
    /** Lazily resolved so composition can late-bind the MFA module. */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
    private readonly auditLog?: AuditPort,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AdminLoginOutcome> {
    const em = this.emFactory();
    // The address is folded before it is compared, because it was folded before
    // it was stored: Postgres' `=` on `text` is case-sensitive, so an operator
    // created as `Anna.Nowak@endora.pl` matched no row when they typed the
    // address they were handed, and the refusal below says nothing about
    // casing. `normalizeEmailAddress` is the same fold the write applies.
    const admin = await em.findOne(AdminUser, {
      email: normalizeEmailAddress(input.email),
      deletedAt: null,
    });
    if (!admin || admin.status !== 'active') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid email or password.');
    }
    const ok = await verifyPassword(admin.passwordHash, input.password);
    if (!ok) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid email or password.');
    }

    // Second factor (feature 042). No session until it succeeds.
    const mfaPort = this.getMfaLoginPort?.();
    if (mfaPort) {
      const decision = await mfaPort.beginLogin(
        { subjectType: 'admin', subjectId: admin.id },
        { salesChannelId: null, organizationId: null },
      );
      if (decision.kind === 'challenge') {
        return { status: 'mfaRequired', challengeId: decision.challengeId };
      }
      if (decision.kind === 'setup') {
        return { status: 'mfaSetupRequired', setupTicket: decision.setupTicket };
      }
    }

    const session = await this.sessionPort.createSession({
      kind: 'admin',
      adminUserId: admin.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });
    // command-coverage-ignore: stamps lastLoginAt — high-volume auth bookkeeping
    // (session lifecycle owned by SessionService), not an audited domain write.
    admin.lastLoginAt = new Date();
    await em.flush();
    return {
      status: 'authenticated',
      adminUser: admin,
      sessionCookieValue: session.cookieValue,
      sessionExpiresAt: session.expiresAt,
    };
  }

  async changePassword(
    adminUserId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const em = this.emFactory();
    const admin = await em.findOne(AdminUser, { id: adminUserId, deletedAt: null });
    if (!admin) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    const ok = await verifyPassword(admin.passwordHash, currentPassword);
    if (!ok) {
      throw new HttpError(
        401,
        ERROR_CODES.CURRENT_PASSWORD_INVALID,
        'Current password is incorrect.',
      );
    }
    admin.passwordHash = await hashPassword(newPassword);
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'admin_user.change_password',
        objectType: 'admin_user',
        objectId: admin.id,
        stateBefore: null,
        stateAfter: { via: 'self_service' },
      });
    }
    await em.flush();
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionPort.destroySession(sessionId);
  }
}
