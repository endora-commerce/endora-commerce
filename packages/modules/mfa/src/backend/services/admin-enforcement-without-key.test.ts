import { describe, expect, it } from 'vitest';
import { MFA_SETTING_CODES, type SettingWriteValidationInput } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  createAdminEnforcementSettingValidator,
  warnOfUnenforceableAdminSetting,
} from './admin-enforcement-without-key.js';

/**
 * Issue #930 — `mfa.admin.totp_enforced` without `MFA_SECRET_ENCRYPTION_KEY`.
 *
 * Without the key this module serves no enrolment route, so a requirement to
 * enrol is one nobody can meet. The setting's write refuses to turn it on, and
 * an instance already in that state is told so at every boot.
 */
function writeOf(proposedValue: unknown): SettingWriteValidationInput {
  return {
    code: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
    ownerModuleId: 'mfa',
    proposedValue,
    projection: [],
    targetedChannelIds: [],
  };
}

describe('the mfa.admin.totp_enforced write validator', () => {
  it('answers for that one setting, on behalf of mfa', () => {
    const validator = createAdminEnforcementSettingValidator(() => false);
    expect(validator.contributorModuleId).toBe('mfa');
    expect(validator.codes).toEqual([MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]);
  });

  it('refuses turning it on when no second factor can be enrolled', async () => {
    const validator = createAdminEnforcementSettingValidator(() => false);
    const refusal = await validator.validate(writeOf(true)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(HttpError);
    const error = refusal as HttpError;
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error.details).toEqual({
      code: 'encryption_key_missing',
      reason: 'encryption_key_missing',
      setting: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
    });
  });

  it('always lets it be turned off', async () => {
    const validator = createAdminEnforcementSettingValidator(() => false);
    await expect(validator.validate(writeOf(false))).resolves.toBeUndefined();
  });

  it('lets it be turned on when a factor can be enrolled', async () => {
    const validator = createAdminEnforcementSettingValidator(() => true);
    await expect(validator.validate(writeOf(true))).resolves.toBeUndefined();
  });
});

describe('the boot warning for mfa.admin.totp_enforced without a key', () => {
  function capture() {
    const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
    return {
      warnings,
      warn: (fields: Record<string, unknown>, message: string) => {
        warnings.push({ fields, message });
      },
    };
  }

  it('warns when the setting is on and no factor can be enrolled', async () => {
    const { warnings, warn } = capture();
    await warnOfUnenforceableAdminSetting({
      hasEncryptionKey: false,
      readEnforced: async () => true,
      warn,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.fields).toEqual({ setting: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED });
    expect(warnings[0]!.message).toContain('MFA_SECRET_ENCRYPTION_KEY');
    expect(warnings[0]!.message).toContain(MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED);
    expect(warnings[0]!.message).toContain('not applied');
  });

  it('is silent when the setting is off', async () => {
    const { warnings, warn } = capture();
    await warnOfUnenforceableAdminSetting({
      hasEncryptionKey: false,
      readEnforced: async () => false,
      warn,
    });
    expect(warnings).toEqual([]);
  });

  it('is silent, and reads nothing, when the key is configured', async () => {
    const { warnings, warn } = capture();
    let read = false;
    await warnOfUnenforceableAdminSetting({
      hasEncryptionKey: true,
      readEnforced: async () => {
        read = true;
        return true;
      },
      warn,
    });
    expect(read).toBe(false);
    expect(warnings).toEqual([]);
  });
});
