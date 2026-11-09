import {
  MFA_SETTING_CODES,
  type MfaAdminEnforcementPort,
  type SettingNoticeProvider,
  type SettingsValueChangedPayload,
} from '@endora-commerce/contracts';

/**
 * Issue #349, E-349-1 (owner ruling 2026-11-08) — `mfa.admin.totp_enforced`
 * gets what a role's `requiresTwoFactor` got in #934.
 *
 * An administrator session lasts thirty days, so a requirement applied only at
 * the next sign-in could stay unenforced for a month — and "a role requires it"
 * would then be enforced faster than "everyone requires it". So switching the
 * setting on ends the sessions every administrator without an active second
 * factor opened without one, sparing the session the change was made from, and
 * the Settings screen says how many before it saves.
 *
 * The write is `settings`'; this module hears of it through
 * `settings.value_changed`, which `settings` emits after the commit, so a write
 * that is refused or rolled back signs nobody out. Without an encryption key
 * the enforcement port ends nothing (issue #948): nothing is enforced there.
 */

const ENFORCED = MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED;

export interface EndSessionsOnAdminEnforcementDeps {
  /** `mfa.admin.totp_enforced` as it reads now, platform-wide. */
  readonly readEnforced: () => Promise<boolean>;
  /** Every administrator account that is not deleted. */
  readonly liveAdminIds: () => Promise<readonly string[]>;
  readonly enforcement: Pick<MfaAdminEnforcementPort, 'endUnprotectedAdminSessions'>;
}

/** The part of the event this subscriber reads. */
export type AdminEnforcementSettingEvent = Pick<SettingsValueChangedPayload, 'settingCode'> &
  Partial<Pick<SettingsValueChangedPayload, 'actorAdminUserId' | 'actorSessionId'>>;

/**
 * The `settings.value_changed` subscriber. It acts on the value in force after
 * the write rather than on the write itself: with the setting on, no session
 * opened without a second factor should be left, so a write that leaves it on
 * ends whatever such session there is — after a first switch-on, normally none.
 */
export function createEndSessionsOnAdminEnforcement(
  deps: EndSessionsOnAdminEnforcementDeps,
): (event: AdminEnforcementSettingEvent) => Promise<void> {
  return async (event) => {
    if (event.settingCode !== ENFORCED) return;
    if (!(await deps.readEnforced())) return;
    const adminUserIds = await deps.liveAdminIds();
    if (adminUserIds.length === 0) return;
    await deps.enforcement.endUnprotectedAdminSessions(adminUserIds, {
      trigger: 'setting_enabled',
      settingCode: ENFORCED,
      ...(event.actorSessionId ? { exceptSessionId: event.actorSessionId } : {}),
    });
  };
}

export interface AdminEnforcementSettingConfirmationDeps {
  /** Whether this composition can enrol a second factor (it holds a key). */
  readonly canEnrolSecondFactor: () => boolean;
  readonly liveAdminIds: () => Promise<readonly string[]>;
  readonly countUnprotected: MfaAdminEnforcementPort['countUnprotected'];
}

/**
 * What the Settings screen asks before it switches the setting on. The screen
 * translates it from this module's bundle
 * (`settingLabels.mfa.admin.totp_enforced.confirmation.signs_out_unprotected`,
 * with `{count}`); `message` is its English fallback.
 *
 * Nothing is asked while the setting is already on, when nobody would be
 * signed out, or without an encryption key — where the write is refused
 * (`MFA_ENFORCEMENT_UNAVAILABLE`) and nothing would be enforced anyway.
 */
export function createAdminEnforcementSettingConfirmation(
  deps: AdminEnforcementSettingConfirmationDeps,
): SettingNoticeProvider {
  return {
    contributorModuleId: 'mfa',
    codes: [ENFORCED],
    // The not-in-force notice is `admin-enforcement-without-key.ts`'s.
    async notice() {
      return null;
    },
    async confirmation({ value }) {
      if (value === true || !deps.canEnrolSecondFactor()) return null;
      const count = await deps.countUnprotected(await deps.liveAdminIds());
      if (count === 0) return null;
      return {
        whenValue: true,
        code: 'signs_out_unprotected',
        message:
          `Administrators who have not set up two-step verification: ${count}. They will be ` +
          'signed out now and asked to set it up at their next sign-in. Continue?',
        params: { count },
      };
    },
  };
}
