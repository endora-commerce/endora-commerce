import { z } from 'zod';
import {
  MFA_SETTING_CODES,
  type AdminRolePort,
  type MfaAdminSecondFactorRequirement,
  type MfaDeactivationGuardPort,
} from '@endora-commerce/contracts';
import type { SettingsReader } from './mfa-policy-resolver.js';

/**
 * Whether switching this module off would withdraw a second factor the platform
 * requires of administrators — the question `/platform/modules` asks before an
 * operator switches `mfa` off.
 *
 * The requirement has two sources, the same two `MfaPolicyResolver` reads at
 * sign-in: the setting `mfa.admin.totp_enforced`, read platform-wide (`null`),
 * and any admin role whose `requiresTwoFactor` is set (issue #349), read
 * through `admin_roles`' published port. Either one blocks the switch-off.
 *
 * The resolver answers `false` for a settings read that throws, which suits a
 * login that must not fail on a missing setting; here the same `false` would
 * let the switch-off through on a question nobody answered, so every error is
 * left to surface and the flip is refused with it.
 */
export class MfaDeactivationGuardService implements MfaDeactivationGuardPort {
  constructor(
    private readonly settings: SettingsReader,
    private readonly adminRoles: Pick<AdminRolePort, 'list'>,
  ) {}

  async isAdminSecondFactorRequired(): Promise<boolean> {
    const { setting, roleCodes } = await this.requirement();
    return setting || roleCodes.length > 0;
  }

  async requirement(): Promise<MfaAdminSecondFactorRequirement> {
    const [setting, roles] = await Promise.all([
      this.settings.get(MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED, null, z.boolean()),
      this.adminRoles.list(),
    ]);
    return {
      setting,
      roleCodes: roles.filter((role) => role.requiresTwoFactor).map((role) => role.code),
    };
  }
}
