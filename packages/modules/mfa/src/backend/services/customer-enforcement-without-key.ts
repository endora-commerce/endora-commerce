import {
  CUSTOMER_ENCRYPTION_KEY_MISSING,
  ENCRYPTION_KEY_MISSING,
  ERROR_CODES,
  MFA_SETTING_CODES,
  type SettingNoticeProvider,
  type SettingWriteValidator,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #947 — the customer requirements, `mfa.storefront.totp_enforced` and
 * an organization's policy, on an instance with no `MFA_SECRET_ENCRYPTION_KEY`.
 *
 * The terms are #930's for `mfa.admin.totp_enforced`
 * (`admin-enforcement-without-key.ts`), with the same predicate — whether this
 * composition can enrol a second factor: without the key this module serves no
 * enrolment route, so a requirement to enrol is one nobody can meet.
 * `MfaPolicyResolver` does not apply either requirement there, and:
 *
 *  - turning either **on** is refused (off → on only; turning it off, and
 *    writing `true` over `true`, are never refused). The setting refuses
 *    through `settings`' validator registry; the policy refuses in
 *    `MfaOrgPolicyService`, which both of its writes — the storefront
 *    administrator's and the Admin UI's — go through;
 *  - while the setting is on (platform-wide or for any channel), its read
 *    carries "not in force: no encryption key", so the Settings screen does not show it as "on" while it does
 *    nothing;
 *  - an instance in that state is told so at every boot, at error level, for
 *    the setting and for the policies alike.
 */

const ENFORCED = MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED;

/** The refusal both customer requirements answer an off → on write with. */
export function customerEnforcementUnavailable(details: Record<string, unknown> = {}): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.MFA_ENFORCEMENT_UNAVAILABLE,
    'Customers cannot be required to use two-step verification: no second factor can be set up ' +
      'on this instance, because MFA_SECRET_ENCRYPTION_KEY is not configured.',
    { code: CUSTOMER_ENCRYPTION_KEY_MISSING, reason: ENCRYPTION_KEY_MISSING, ...details },
  );
}

export interface StorefrontEnforcementValidatorDeps {
  /** Whether this composition can enrol a second factor (it holds a key). */
  readonly canEnrolSecondFactor: () => boolean;
  /**
   * `mfa.storefront.totp_enforced` in force before the write: at a channel
   * (its own row, else platform-wide), or platform-wide for `null`.
   */
  readonly readEnforcedAt: (salesChannelId: string | null) => Promise<boolean>;
}

/**
 * The write rule for `mfa.storefront.totp_enforced`, which is set per sales
 * channel as well as platform-wide. A write of `true` is refused unless the
 * value was already `true` at every scope it targets — the platform-wide
 * value for a platform-wide write, each targeted channel's for a channel
 * write.
 */
export function createStorefrontEnforcementSettingValidator(
  deps: StorefrontEnforcementValidatorDeps,
): SettingWriteValidator {
  return {
    contributorModuleId: 'mfa',
    codes: [ENFORCED],
    async validate({ proposedValue, targetedChannelIds }) {
      if (proposedValue !== true || deps.canEnrolSecondFactor()) return;
      const scopes: Array<string | null> =
        targetedChannelIds.length > 0 ? [...targetedChannelIds] : [null];
      const before = await Promise.all(scopes.map((scope) => deps.readEnforcedAt(scope)));
      if (before.every(Boolean)) return;
      throw customerEnforcementUnavailable({ setting: ENFORCED });
    },
  };
}

export interface StorefrontEnforcementNoticeDeps {
  /** Whether this composition can enrol a second factor (it holds a key). */
  readonly canEnrolSecondFactor: () => boolean;
  /** As {@link StorefrontEnforcementValidatorDeps.readEnforcedAt}. */
  readonly readEnforcedAt: (salesChannelId: string | null) => Promise<boolean>;
  /** Every sales channel, for the setting's per-channel values. */
  readonly listChannels: () => Promise<ReadonlyArray<{ readonly id: string; readonly code: string }>>;
}

/**
 * The Settings read's notice for `mfa.storefront.totp_enforced`, while it is
 * on platform-wide or for any sales channel (architect ruling on PR #981:
 * the setting is set per channel, so a channel's own `true` is as much "not in
 * force" as the platform-wide one). Reads nothing where a factor can be
 * enrolled. The screen translates it from this module's bundle
 * (`settingLabels.mfa.storefront.totp_enforced.notice.encryption_key_missing`);
 * `message` is its English fallback.
 */
export function createStorefrontEnforcementSettingNotice(
  deps: StorefrontEnforcementNoticeDeps,
): SettingNoticeProvider {
  return {
    contributorModuleId: 'mfa',
    codes: [ENFORCED],
    async notice({ value }) {
      if (deps.canEnrolSecondFactor()) return null;
      if (value !== true && !(await onForAnyChannel(deps))) return null;
      return {
        code: ENCRYPTION_KEY_MISSING,
        message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
      };
    },
  };
}

async function onForAnyChannel(deps: StorefrontEnforcementNoticeDeps): Promise<boolean> {
  for (const channel of await deps.listChannels()) {
    if (await deps.readEnforcedAt(channel.id)) return true;
  }
  return false;
}

export interface CustomerRequirementBootReportDeps {
  readonly hasEncryptionKey: boolean;
  /** Every sales channel, for the setting's per-channel values. */
  readonly listChannels: () => Promise<ReadonlyArray<{ readonly id: string; readonly code: string }>>;
  /** As {@link StorefrontEnforcementValidatorDeps.readEnforcedAt}. */
  readonly readEnforcedAt: (salesChannelId: string | null) => Promise<boolean>;
  /** This module's own table: how many organizations' policies require a second factor. */
  readonly countEnforcingOrganizations: () => Promise<number>;
  readonly error: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Logs, at error level, each customer requirement that is set and not
 * applied: the storefront setting (platform-wide, and the channels it is on
 * for) and the organizations whose policy requires a second factor. Reads
 * nothing when the key is configured, which is every instance not in this
 * state.
 */
export async function reportUnenforceableCustomerRequirements(
  deps: CustomerRequirementBootReportDeps,
): Promise<void> {
  if (deps.hasEncryptionKey) return;

  const platformWide = await deps.readEnforcedAt(null);
  const channels = await deps.listChannels();
  const onFor: string[] = [];
  for (const channel of channels) {
    if (await deps.readEnforcedAt(channel.id)) onFor.push(channel.code);
  }
  if (platformWide || onFor.length > 0) {
    deps.error(
      { setting: ENFORCED, platformWide, salesChannels: onFor },
      `${ENFORCED} is on${onFor.length > 0 ? ` for sales channel(s) ${onFor.join(', ')}` : ''}, ` +
        'but MFA_SECRET_ENCRYPTION_KEY is not set, so no second factor can be enrolled. The ' +
        'requirement is not applied: customers without a second factor sign in with their ' +
        `password alone. Set MFA_SECRET_ENCRYPTION_KEY and restart to apply it, or turn ${ENFORCED} off.`,
    );
  }

  const enforcingOrganizations = await deps.countEnforcingOrganizations();
  if (enforcingOrganizations > 0) {
    deps.error(
      { enforcingOrganizations },
      `${enforcingOrganizations} organization(s) require two-step verification of their members, ` +
        'but MFA_SECRET_ENCRYPTION_KEY is not set, so no second factor can be enrolled. The ' +
        'requirement is not applied: their members sign in with their password alone. Set ' +
        'MFA_SECRET_ENCRYPTION_KEY and restart to apply it.',
    );
  }
}
