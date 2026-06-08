import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { MFA_SETTING_CODES } from '@b2b/contracts';
import {
  MfaPolicyResolver,
  type SettingsReader,
} from '../../../src/modules/mfa/services/mfa-policy-resolver.js';

/**
 * Fake settings reader: returns the value mapped per (code, channel), or
 * throws "not registered" for codes absent from the map (so we also exercise
 * the defensive fallback to `false`).
 */
function fakeSettings(values: Record<string, boolean>): SettingsReader {
  return {
    async get<T>(code: string, _channel: string, schema: z.ZodType<T>): Promise<T> {
      if (!(code in values)) throw new Error('SettingNotRegistered');
      return schema.parse(values[code]);
    },
  };
}

/** Fake em factory whose findOne returns a fixed org policy (or null). */
function fakeEmFactory(enforceTotp: boolean | null) {
  return () =>
    ({
      async findOne() {
        return enforceTotp === null ? null : { enforceTotp };
      },
    }) as never;
}

describe('MfaPolicyResolver', () => {
  it('storefront: disabled by default when nothing is set', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null));
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: null },
    );
    expect(p).toEqual({
      totpEnabled: false,
      totpEnforced: false,
      googleEnabled: false,
      microsoftEnabled: false,
    });
  });

  it('enforced ⇒ enabled invariant (FR-016)', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED]: true }),
      fakeEmFactory(null),
    );
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: 'ch1' },
    );
    expect(p.totpEnforced).toBe(true);
    expect(p.totpEnabled).toBe(true);
  });

  it('organization enforcement is additive for customers', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(true));
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: null, organizationId: 'org1' },
    );
    expect(p.totpEnforced).toBe(true);
    expect(p.totpEnabled).toBe(true);
  });

  it('admin reads admin-surface settings and ignores org policy', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({
        [MFA_SETTING_CODES.ADMIN_TOTP_ENABLED]: true,
        [MFA_SETTING_CODES.ADMIN_GOOGLE_ENABLED]: true,
      }),
      fakeEmFactory(true),
    );
    const p = await resolver.resolve(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null, organizationId: 'org1' },
    );
    expect(p.totpEnabled).toBe(true);
    expect(p.totpEnforced).toBe(false);
    expect(p.googleEnabled).toBe(true);
    expect(p.microsoftEnabled).toBe(false);
  });
});
