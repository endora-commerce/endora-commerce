import { describe, expect, it } from 'vitest';
import {
  ENCRYPTION_KEY_MISSING,
  MFA_SETTING_CODES,
  type SettingWriteValidationInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  CUSTOMER_ENCRYPTION_KEY_MISSING,
  createStorefrontEnforcementSettingNotice,
  createStorefrontEnforcementSettingValidator,
  reportUnenforceableCustomerRequirements,
} from './customer-enforcement-without-key.js';

/**
 * Issue #947 — `mfa.storefront.totp_enforced` and the per-organization policy
 * without `MFA_SECRET_ENCRYPTION_KEY`, on the terms #930 set for
 * `mfa.admin.totp_enforced`: the write refuses to turn it on, the Settings
 * screen says it is not in force, and an instance already in that state is
 * told so at every boot, at error level.
 */
const ENFORCED = MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED;

function writeOf(proposedValue: unknown, targetedChannelIds: string[] = []): SettingWriteValidationInput {
  return {
    code: ENFORCED,
    ownerModuleId: 'mfa',
    proposedValue,
    projection: [],
    targetedChannelIds,
  };
}

/** `before` maps a scope (`'*'` for platform-wide) to the value in force before the write. */
function validator(canEnrol: boolean, before: Record<string, boolean>) {
  const asked: Array<string | null> = [];
  const v = createStorefrontEnforcementSettingValidator({
    canEnrolSecondFactor: () => canEnrol,
    readEnforcedAt: async (salesChannelId) => {
      asked.push(salesChannelId);
      return before[salesChannelId ?? '*'] ?? false;
    },
  });
  return { v, asked };
}

async function refusalOf(promise: Promise<void>): Promise<HttpError | null> {
  return promise.then(
    () => null,
    (error: unknown) => error as HttpError,
  );
}

describe('the mfa.storefront.totp_enforced write validator', () => {
  it('answers for that one setting, on behalf of mfa', () => {
    const { v } = validator(false, {});
    expect(v.contributorModuleId).toBe('mfa');
    expect(v.codes).toEqual([ENFORCED]);
  });

  it('refuses turning it on platform-wide when no second factor can be enrolled', async () => {
    const { v, asked } = validator(false, {});
    const error = await refusalOf(v.validate(writeOf(true)));
    expect(error).toBeInstanceOf(HttpError);
    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error!.details).toEqual({
      code: CUSTOMER_ENCRYPTION_KEY_MISSING,
      reason: ENCRYPTION_KEY_MISSING,
      setting: ENFORCED,
    });
    expect(asked).toEqual([null]);
  });

  it('refuses turning it on for a channel where it was off', async () => {
    const { v, asked } = validator(false, { ch1: true, ch2: false });
    const error = await refusalOf(v.validate(writeOf(true, ['ch1', 'ch2'])));
    expect(error?.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(asked).toEqual(['ch1', 'ch2']);
  });

  it('accepts re-saving an unchanged true, platform-wide or on channels', async () => {
    await expect(validator(false, { '*': true }).v.validate(writeOf(true))).resolves.toBeUndefined();
    await expect(
      validator(false, { ch1: true }).v.validate(writeOf(true, ['ch1'])),
    ).resolves.toBeUndefined();
  });

  it('always lets it be turned off, and reads nothing to decide that', async () => {
    const { v, asked } = validator(false, {});
    await expect(v.validate(writeOf(false))).resolves.toBeUndefined();
    await expect(v.validate(writeOf(false, ['ch1']))).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('lets it be turned on when a factor can be enrolled', async () => {
    const { v, asked } = validator(true, {});
    await expect(v.validate(writeOf(true))).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });
});

describe('the mfa.storefront.totp_enforced Settings notice', () => {
  it('answers for that one setting, on behalf of mfa', () => {
    const n = createStorefrontEnforcementSettingNotice(() => false);
    expect(n.contributorModuleId).toBe('mfa');
    expect(n.codes).toEqual([ENFORCED]);
  });

  it('says the setting is not in force while it is on and no factor can be enrolled', async () => {
    const n = createStorefrontEnforcementSettingNotice(() => false);
    expect(await n.notice({ code: ENFORCED, ownerModuleId: 'mfa', value: true })).toEqual({
      code: ENCRYPTION_KEY_MISSING,
      message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
    });
  });

  it('says nothing while it is off, or where a factor can be enrolled', async () => {
    expect(
      await createStorefrontEnforcementSettingNotice(() => false).notice({
        code: ENFORCED,
        ownerModuleId: 'mfa',
        value: false,
      }),
    ).toBeNull();
    expect(
      await createStorefrontEnforcementSettingNotice(() => true).notice({
        code: ENFORCED,
        ownerModuleId: 'mfa',
        value: true,
      }),
    ).toBeNull();
  });
});

describe('the customer requirement boot report', () => {
  function run(options: {
    hasEncryptionKey: boolean;
    enforcedAt?: Record<string, boolean>;
    enforcingOrganizations?: number;
  }) {
    const logged: Array<{ fields: Record<string, unknown>; message: string }> = [];
    let reads = 0;
    const done = reportUnenforceableCustomerRequirements({
      hasEncryptionKey: options.hasEncryptionKey,
      listChannels: async () => {
        reads += 1;
        return [
          { id: 'ch1', code: 'b2b' },
          { id: 'ch2', code: 'retail' },
        ];
      },
      readEnforcedAt: async (salesChannelId) => {
        reads += 1;
        return options.enforcedAt?.[salesChannelId ?? '*'] ?? false;
      },
      countEnforcingOrganizations: async () => {
        reads += 1;
        return options.enforcingOrganizations ?? 0;
      },
      error: (fields, message) => logged.push({ fields, message }),
    });
    return { done, logged, reads: () => reads };
  }

  it('reads nothing and says nothing when the key is configured', async () => {
    const r = run({ hasEncryptionKey: true, enforcedAt: { '*': true }, enforcingOrganizations: 3 });
    await r.done;
    expect(r.logged).toEqual([]);
    expect(r.reads()).toBe(0);
  });

  it('says nothing when no customer requirement is set', async () => {
    const r = run({ hasEncryptionKey: false });
    await r.done;
    expect(r.logged).toEqual([]);
  });

  it('names the setting and the channels it is on for, saying it is not applied', async () => {
    const r = run({ hasEncryptionKey: false, enforcedAt: { ch2: true } });
    await r.done;
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]!.fields).toEqual({
      setting: ENFORCED,
      platformWide: false,
      salesChannels: ['retail'],
    });
    expect(r.logged[0]!.message).toContain(ENFORCED);
    expect(r.logged[0]!.message).toContain('not applied');
    expect(r.logged[0]!.message).toContain('MFA_SECRET_ENCRYPTION_KEY');
  });

  it('reports the platform-wide value as well', async () => {
    const r = run({ hasEncryptionKey: false, enforcedAt: { '*': true, ch1: true, ch2: true } });
    await r.done;
    expect(r.logged[0]!.fields).toEqual({
      setting: ENFORCED,
      platformWide: true,
      salesChannels: ['b2b', 'retail'],
    });
  });

  it('counts the organizations whose policy requires a second factor, saying it is not applied', async () => {
    const r = run({ hasEncryptionKey: false, enforcingOrganizations: 2 });
    await r.done;
    expect(r.logged).toHaveLength(1);
    expect(r.logged[0]!.fields).toEqual({ enforcingOrganizations: 2 });
    expect(r.logged[0]!.message).toContain('2 organization');
    expect(r.logged[0]!.message).toContain('not applied');
  });
});
