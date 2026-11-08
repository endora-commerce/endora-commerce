import type {
  AuthSessionPort,
  MfaAdminEnforcementPort,
  MfaEndUnprotectedAdminSessionsOptions,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';

export interface MfaAdminEnforcementDeps {
  /** The subset of these administrators with an active enrolment — this module's own table. */
  activeAdminIds: (adminUserIds: readonly string[]) => Promise<string[]>;
  /** `auth`'s published session surface. */
  sessions: Pick<AuthSessionPort, 'destroyAllForAdmin'>;
  /** Withdraws an administrator's pending challenges and setup tickets. */
  invalidatePending: (adminUserId: string) => Promise<void>;
  auditLog: Pick<AuditPort, 'record'>;
  /** Whether this composition can enrol a factor: it was given an encryption key. */
  canEnforce: boolean;
}

/**
 * Issue #349 — what a role's two-factor requirement does to the sessions it
 * finds already open.
 *
 * Mirrors `factor-withdrawal.ts`, which ends sessions when a factor is removed:
 * the sessions here were opened **without** a factor that is now required, so
 * they go, and so do the logins their holders had begun. An administrator with
 * an active enrolment is left alone — their session was opened through a
 * challenge, or they proved the factor by confirming it.
 *
 * Called by `admin_users` after its write is persisted, never before, so a
 * write that is refused or rolled back signs nobody out. Session revocation is
 * auth bookkeeping rather than a domain write, as it is for a password change
 * and a factor removal; it is audited here, one row per call that affected
 * anybody.
 */
export class MfaAdminEnforcementService implements MfaAdminEnforcementPort {
  constructor(private readonly deps: MfaAdminEnforcementDeps) {}

  async endUnprotectedAdminSessions(
    adminUserIds: readonly string[],
    options: MfaEndUnprotectedAdminSessionsOptions,
  ): Promise<number> {
    const unprotected = await this.unprotected(adminUserIds);
    const destroyOptions =
      options.exceptSessionId === undefined ? undefined : { exceptSessionId: options.exceptSessionId };
    for (const adminUserId of unprotected) {
      await this.deps.sessions.destroyAllForAdmin(adminUserId, destroyOptions);
      await this.deps.invalidatePending(adminUserId);
    }
    if (unprotected.length > 0) {
      await this.deps.auditLog.record({
        action: 'mfa.admin_sessions_ended_for_requirement',
        objectType: 'admin_role',
        objectId: options.roleCode,
        stateAfter: { trigger: options.trigger, roleCode: options.roleCode, count: unprotected.length },
      });
    }
    return unprotected.length;
  }

  async countUnprotected(adminUserIds: readonly string[]): Promise<number> {
    return (await this.unprotected(adminUserIds)).length;
  }

  async canEnforceAdminSecondFactor(): Promise<boolean> {
    return this.deps.canEnforce;
  }

  private async unprotected(adminUserIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(adminUserIds)];
    if (unique.length === 0) return [];
    const enrolled = new Set(await this.deps.activeAdminIds(unique));
    return unique.filter((id) => !enrolled.has(id));
  }
}
