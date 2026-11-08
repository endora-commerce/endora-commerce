import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ENCRYPTION_KEY_MISSING,
  MFA_SETTING_CODES,
  type SettingWriteValidationInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  createAdminEnforcementSettingNotice,
  createAdminEnforcementSettingValidator,
  reportUnenforceableAdminSetting,
} from './admin-enforcement-without-key.js';

/**
 * Issue #930 — `mfa.admin.totp_enforced` without `MFA_SECRET_ENCRYPTION_KEY`.
 *
 * Without the key this module serves no enrolment route, so a requirement to
 * enrol is one nobody can meet. The setting's write refuses to turn it on, the
 * Settings screen says the setting is not in force, and an instance already in
 * that state is told so at every boot, at error level.
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

function validator(canEnrol: boolean, currentlyEnforced: boolean) {
  return createAdminEnforcementSettingValidator({
    canEnrolSecondFactor: () => canEnrol,
    readEnforced: async () => currentlyEnforced,
  });
}

describe('the shared reason', () => {
  it('is one contracts constant', () => {
    expect(ENCRYPTION_KEY_MISSING).toBe('encryption_key_missing');
  });
});

describe('the mfa.admin.totp_enforced write validator', () => {
  it('answers for that one setting, on behalf of mfa', () => {
    const v = validator(false, false);
    expect(v.contributorModuleId).toBe('mfa');
    expect(v.codes).toEqual([MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]);
  });

  it('refuses turning it on when no second factor can be enrolled', async () => {
    const refusal = await validator(false, false)
      .validate(writeOf(true))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refusal).toBeInstanceOf(HttpError);
    const error = refusal as HttpError;
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error.details).toEqual({
      code: ENCRYPTION_KEY_MISSING,
      reason: ENCRYPTION_KEY_MISSING,
      setting: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
    });
  });

  it('accepts re-saving an unchanged true, which a settings form may resend', async () => {
    await expect(validator(false, true).validate(writeOf(true))).resolves.toBeUndefined();
  });

  it('always lets it be turned off', async () => {
    await expect(validator(false, true).validate(writeOf(false))).resolves.toBeUndefined();
  });

  it('lets it be turned on when a factor can be enrolled', async () => {
    await expect(validator(true, false).validate(writeOf(true))).resolves.toBeUndefined();
  });
});

describe('the mfa.admin.totp_enforced notice', () => {
  const read = (value: unknown) => ({
    code: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED,
    ownerModuleId: 'mfa',
    value,
  });

  it('says the setting is not in force while it is on and no factor can be enrolled', async () => {
    const provider = createAdminEnforcementSettingNotice(() => false);
    expect(provider.contributorModuleId).toBe('mfa');
    expect(provider.codes).toEqual([MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]);
    expect(await provider.notice(read(true))).toEqual({
      code: ENCRYPTION_KEY_MISSING,
      message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
    });
  });

  it('says nothing while the setting is off', async () => {
    expect(await createAdminEnforcementSettingNotice(() => false).notice(read(false))).toBeNull();
  });

  it('says nothing where a factor can be enrolled', async () => {
    expect(await createAdminEnforcementSettingNotice(() => true).notice(read(true))).toBeNull();
  });

  it('ships the sentence in both languages, under the key the Settings screen reads', () => {
    const key = `settingLabels.${MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED}.notice.${ENCRYPTION_KEY_MISSING}`;
    const bundle = (language: string) =>
      JSON.parse(
        readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
      ) as Record<string, string>;
    expect(bundle('en')[key]).toBe('Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).');
    expect(bundle('pl')[key]).toBe(
      'Nie obowiązuje: brak klucza szyfrowania (MFA_SECRET_ENCRYPTION_KEY).',
    );
  });
});

describe('the boot report for mfa.admin.totp_enforced without a key', () => {
  function capture() {
    const errors: Array<{ fields: Record<string, unknown>; message: string }> = [];
    return {
      errors,
      error: (fields: Record<string, unknown>, message: string) => {
        errors.push({ fields, message });
      },
    };
  }

  it('logs an error when the setting is on and no factor can be enrolled', async () => {
    const { errors, error } = capture();
    await reportUnenforceableAdminSetting({
      hasEncryptionKey: false,
      readEnforced: async () => true,
      error,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.fields).toEqual({ setting: MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED });
    expect(errors[0]!.message).toContain('MFA_SECRET_ENCRYPTION_KEY');
    expect(errors[0]!.message).toContain(MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED);
    expect(errors[0]!.message).toContain('not applied');
  });

  it('is silent when the setting is off', async () => {
    const { errors, error } = capture();
    await reportUnenforceableAdminSetting({
      hasEncryptionKey: false,
      readEnforced: async () => false,
      error,
    });
    expect(errors).toEqual([]);
  });

  it('is silent, and reads nothing, when the key is configured', async () => {
    const { errors, error } = capture();
    let read = false;
    await reportUnenforceableAdminSetting({
      hasEncryptionKey: true,
      readEnforced: async () => {
        read = true;
        return true;
      },
      error,
    });
    expect(read).toBe(false);
    expect(errors).toEqual([]);
  });
});
