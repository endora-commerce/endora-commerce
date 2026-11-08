import { describe, expect, it } from 'vitest';
import { MFA_SETTING_CODES, type AdminRoleRecord } from '@endora-commerce/contracts';
import { MfaDeactivationGuardService } from './mfa-deactivation-guard.service.js';
import type { SettingsReader } from './mfa-policy-resolver.js';

/**
 * The answer `/platform/modules` asks before switching `mfa` off: is a second
 * factor currently required of administrators? Read platform-wide, as the
 * login policy reads it — and, unlike the login policy, a read that fails is
 * not taken as "no".
 */
function readerOf(values: Record<string, unknown>, reads: Array<[string, string | null]> = []): SettingsReader {
  return {
    get: async <T>(code: string, salesChannelId: string | null) => {
      reads.push([code, salesChannelId]);
      if (!(code in values)) throw new Error(`setting ${code} is not registered`);
      return values[code] as T;
    },
  };
}

function rolesOf(...flagged: Array<[code: string, requiresTwoFactor: boolean]>) {
  return {
    list: async (): Promise<AdminRoleRecord[]> =>
      flagged.map(([code, requiresTwoFactor]) => ({
        id: `id-${code}`,
        code,
        name: code,
        permissions: [],
        requiresTwoFactor,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
  };
}

describe('MfaDeactivationGuardService', () => {
  it('answers the administrator requirement, read platform-wide', async () => {
    const reads: Array<[string, string | null]> = [];
    const required = new MfaDeactivationGuardService(
      readerOf({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true }, reads),
      rolesOf(),
    );
    expect(await required.isAdminSecondFactorRequired()).toBe(true);
    expect(reads).toEqual([[MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED, null]]);

    const optional = new MfaDeactivationGuardService(
      readerOf({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: false }),
      rolesOf(['sales', false]),
    );
    expect(await optional.isAdminSecondFactorRequired()).toBe(false);
  });

  it('lets a failed read surface instead of answering "not required"', async () => {
    const guard = new MfaDeactivationGuardService(readerOf({}), rolesOf());
    await expect(guard.isAdminSecondFactorRequired()).rejects.toThrow('is not registered');
  });

  // Issue #349 — a role's `requiresTwoFactor` is a second source of the
  // administrator requirement, and switching `mfa` off would withdraw it too.
  it('answers "required" when a role requires a second factor and the setting does not', async () => {
    const guard = new MfaDeactivationGuardService(
      readerOf({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: false }),
      rolesOf(['sales', false], ['accounting', true], ['admins', true]),
    );
    expect(await guard.isAdminSecondFactorRequired()).toBe(true);
    expect(await guard.requirement()).toEqual({ setting: false, roleCodes: ['accounting', 'admins'] });
  });

  it('names both sources when both require it', async () => {
    const guard = new MfaDeactivationGuardService(
      readerOf({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true }),
      rolesOf(['accounting', true]),
    );
    expect(await guard.requirement()).toEqual({ setting: true, roleCodes: ['accounting'] });
  });

  it('lets a failed role read surface instead of answering "not required"', async () => {
    const guard = new MfaDeactivationGuardService(
      readerOf({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: false }),
      { list: async () => { throw new Error('admin_roles unavailable'); } },
    );
    await expect(guard.isAdminSecondFactorRequired()).rejects.toThrow('admin_roles unavailable');
  });
});
