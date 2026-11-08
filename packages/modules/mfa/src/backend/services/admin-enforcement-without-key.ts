import {
  ENCRYPTION_KEY_MISSING,
  ERROR_CODES,
  MFA_SETTING_CODES,
  type SettingNoticeProvider,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #930 — `mfa.admin.totp_enforced` on an instance with no
 * `MFA_SECRET_ENCRYPTION_KEY`.
 *
 * Without the key this module composes but serves no enrolment or verify
 * route, so a requirement to enrol is one nobody can meet. `MfaPolicyResolver`
 * does not apply the setting there, and three things make sure nobody is left
 * believing it is applied:
 *
 *  - the setting's write refuses to turn it **on** (off → on only: re-saving an
 *    unchanged `true` answers as any re-save does, because a settings form may
 *    resend every value), through `settings`' validator registry, so the
 *    Settings screen and its API refuse alike;
 *  - while it is on, the setting's read carries a notice — "not in force: no
 *    encryption key" — so the Settings screen does not show it as "on" while it
 *    does nothing, which is the defect class of issue #349;
 *  - an instance in that state is told so at every boot, at error level.
 */

const ENFORCED = MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED;

export interface AdminEnforcementValidatorDeps {
  /** Whether this composition can enrol a second factor (it holds a key). */
  readonly canEnrolSecondFactor: () => boolean;
  /** The value in force before the write: `mfa.admin.totp_enforced`, platform-wide. */
  readonly readEnforced: () => Promise<boolean>;
}

/**
 * The write rule for `mfa.admin.totp_enforced`. Refuses only a write that
 * turns it on; turning it off, and writing `true` over `true`, are never
 * refused.
 *
 * `details.code` is the token that picks the sentence
 * (`errors.MFA_ENFORCEMENT_UNAVAILABLE.encryption_key_missing`); `details.reason`
 * carries the same value under the name a client reads, as the role write's
 * refusal does.
 */
export function createAdminEnforcementSettingValidator(
  deps: AdminEnforcementValidatorDeps,
): SettingWriteValidator {
  return {
    contributorModuleId: 'mfa',
    codes: [ENFORCED],
    async validate({ proposedValue }) {
      if (proposedValue !== true || deps.canEnrolSecondFactor()) return;
      if (await deps.readEnforced()) return;
      throw new HttpError(
        409,
        ERROR_CODES.MFA_ENFORCEMENT_UNAVAILABLE,
        'Administrators cannot be required to use two-step verification: no second factor can be ' +
          'set up on this instance, because MFA_SECRET_ENCRYPTION_KEY is not configured.',
        { code: ENCRYPTION_KEY_MISSING, reason: ENCRYPTION_KEY_MISSING, setting: ENFORCED },
      );
    },
  };
}

/**
 * The Settings read's notice for `mfa.admin.totp_enforced`. The screen
 * translates it from this module's bundle
 * (`settingLabels.mfa.admin.totp_enforced.notice.encryption_key_missing`);
 * `message` is its English fallback.
 */
export function createAdminEnforcementSettingNotice(
  canEnrolSecondFactor: () => boolean,
): SettingNoticeProvider {
  return {
    contributorModuleId: 'mfa',
    codes: [ENFORCED],
    async notice({ value }) {
      if (value !== true || canEnrolSecondFactor()) return null;
      return {
        code: ENCRYPTION_KEY_MISSING,
        message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
      };
    },
  };
}

export interface AdminSettingBootReportDeps {
  readonly hasEncryptionKey: boolean;
  /** `mfa.admin.totp_enforced`, read platform-wide. */
  readonly readEnforced: () => Promise<boolean>;
  readonly error: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Logs, at error level, that the setting is on and not applied. Reads nothing
 * when the key is configured, which is every instance not in this state.
 */
export async function reportUnenforceableAdminSetting(
  deps: AdminSettingBootReportDeps,
): Promise<void> {
  if (deps.hasEncryptionKey) return;
  if (!(await deps.readEnforced())) return;
  deps.error(
    { setting: ENFORCED },
    `${ENFORCED} is on, but MFA_SECRET_ENCRYPTION_KEY is not set, so no second factor can be ` +
      'enrolled. The requirement is not applied: administrators without a second factor sign ' +
      'in with their password alone. Set MFA_SECRET_ENCRYPTION_KEY and restart to apply it, or ' +
      `turn ${ENFORCED} off.`,
  );
}
