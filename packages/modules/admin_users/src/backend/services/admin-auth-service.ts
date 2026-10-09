import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeEmailAddress,
  type AdminAuthenticationThrottlePort,
  type AuthSessionPort,
  type MfaLoginPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { verifyPassword } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../entities/admin-user.entity.js';

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
    /**
     * Required, not optional: a composition without it would be a sign-in
     * with no limit on wrong passwords, and nothing would report the gap.
     */
    private readonly throttle: AdminAuthenticationThrottlePort,
    /** Lazily resolved so composition can late-bind the MFA module. */
    private readonly getMfaLoginPort?: () => MfaLoginPort | undefined,
  ) {}

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
    /** The verified known-device cookie value, when the request carried one. */
    knownDevice?: string;
  }): Promise<AdminLoginOutcome> {
    const em = this.emFactory();
    // The address is folded before it is compared, because it was folded before
    // it was stored: Postgres' `=` on `text` is case-sensitive, so an operator
    // created as `Operator.Mixed@example.com` matched no row when they typed the
    // address they were handed, and the refusal below says nothing about
    // casing. `normalizeEmailAddress` is the same fold the write applies.
    const email = normalizeEmailAddress(input.email);
    // The attempt is taken before the account is looked up, keyed by the
    // address as typed and folded. So an address that belongs to nobody is
    // throttled exactly like a real one, and while a delay runs neither this
    // lookup nor the password comparison happens — see `AuthenticationThrottle`.
    let admin: AdminUser | null = null;
    const ok = await this.throttle.verify(
      {
        factor: 'password',
        account: email,
        ...(input.ip !== undefined ? { ip: input.ip } : {}),
        ...(input.knownDevice !== undefined ? { knownDevice: input.knownDevice } : {}),
      },
      async () => {
        const found = await em.findOne(AdminUser, { email, deletedAt: null });
        if (!found || found.status !== 'active') return { ok: false };
        admin = found;
        return {
          ok: await verifyPassword(found.passwordHash, input.password),
          adminUserId: found.id,
        };
      },
    );
    // Re-read through a typed local: the assignment above happens inside a
    // callback, which control-flow narrowing does not follow.
    const signedIn = admin as AdminUser | null;
    if (!ok || !signedIn) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Invalid email or password.');
    }

    // Second factor (feature 042). No session until it succeeds.
    const mfaPort = this.getMfaLoginPort?.();
    if (mfaPort) {
      const decision = await mfaPort.beginLogin(
        { subjectType: 'admin', subjectId: signedIn.id },
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
      adminUserId: signedIn.id,
      ...(input.ip !== undefined ? { ipAddress: input.ip } : {}),
      ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
    });
    // command-coverage-ignore: stamps lastLoginAt — high-volume auth bookkeeping
    // (session lifecycle owned by SessionService), not an audited domain write.
    signedIn.lastLoginAt = new Date();
    await em.flush();
    return {
      status: 'authenticated',
      adminUser: signedIn,
      sessionCookieValue: session.cookieValue,
      sessionExpiresAt: session.expiresAt,
    };
  }

  /*
   * There is deliberately no `changePassword` here. One stood in this class
   * with no caller: it verified the current password and audited
   * `admin_user.change_password`, but answered a wrong one with 401 — which the
   * Admin UI reads as an expired session — and revoked nothing. The one
   * implementation is `AdminUserService.updateSelf`, behind
   * `PATCH /api/v1/admin/me`.
   */

  async logout(sessionId: string): Promise<void> {
    await this.sessionPort.destroySession(sessionId);
  }
}
