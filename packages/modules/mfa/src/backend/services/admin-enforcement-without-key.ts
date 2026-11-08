import {
  ERROR_CODES,
  MFA_SETTING_CODES,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #930 — `mfa.admin.totp_enforced` on an instance with no
 * `MFA_SECRET_ENCRYPTION_KEY`.
 *
 * Without the key this module composes but serves no enrolment or verify
 * route, so a requirement to enrol is one nobody can meet. Two guards, the
 * same two the role flag has (issue #349):
 *
 *  - the setting's write refuses to turn it on, through `settings`' validator
 *    registry, so the Settings screen and its API refuse alike;
 *  - an instance already in that state — the key removed after the setting was
 *    turned on, or the setting turned on before this refusal existed — is told
 *    so at every boot. `MfaPolicyResolver` does not apply the setting there,
 *    and the warning says that too, because a requirement that is silently not
 *    applied is the one thing an operator must hear about.
 */

/** Why the requirement cannot be met here: the same token the role write uses. */
const ENCRYPTION_KEY_MISSING = 'encryption_key_missing';

/**
 * The write rule for `mfa.admin.totp_enforced`. `canEnrolSecondFactor` is
 * asked per write; turning the setting off is never refused.
 *
 * `details.code` is the token that picks the sentence
 * (`errors.MFA_ENFORCEMENT_UNAVAILABLE.encryption_key_missing`); `details.reason`
 * carries the same value under the name a client reads, as the role write's
 * refusal does.
 */
export function createAdminEnforcementSettingValidator(
  canEnrolSecondFactor: () => boolean,
): SettingWriteValidator {
  return {
    contributorModuleId: 'mfa',
    codes: [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED],
    async validate({ proposedValue }) {
      if (proposedValue !== true || canEnrolSecondFactor()) return;
      throw new HttpError(
        409,
        ERROR_CODES.MFA_ENFORCEMENT_UNAVAILABLE,
        'Administrators cannot be required to use two-step verification: no second factor can be ' +
          'set up on this instance, because MFA_SECRET_ENCRYPTION_KEY is not configured.',
        {
          code: ENCRYPTION_KEY_MISSING,
          reason: ENCRYPTION_KEY_MISSING,
          setting: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
        },
      );
    },
  };
}

export interface AdminSettingBootWarningDeps {
  readonly hasEncryptionKey: boolean;
  /** `mfa.admin.totp_enforced`, read platform-wide. */
  readonly readEnforced: () => Promise<boolean>;
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Logs the warning when the setting is on and nothing can be enrolled. Reads
 * nothing when the key is configured, which is every instance that is not in
 * this state.
 */
export async function warnOfUnenforceableAdminSetting(
  deps: AdminSettingBootWarningDeps,
): Promise<void> {
  if (deps.hasEncryptionKey) return;
  if (!(await deps.readEnforced())) return;
  deps.warn(
    { setting: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED },
    `${MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED} is on, but MFA_SECRET_ENCRYPTION_KEY is not set, so ` +
      'no second factor can be enrolled. The requirement is not applied: administrators without ' +
      'a second factor sign in with their password alone. Set MFA_SECRET_ENCRYPTION_KEY and ' +
      `restart to apply it, or turn ${MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED} off.`,
  );
}
