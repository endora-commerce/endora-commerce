import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { MFA_SETTING_CODES } from '@endora-commerce/contracts';
import type { AdminRoleResolution } from '@endora-commerce/contracts';
import {
  MfaPolicyResolver,
  type AdminRoleReader,
  type SettingsReader,
} from './mfa-policy-resolver.js';

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

/** A role reader answering one role for every administrator, recording who was asked. */
function roleOf(requiresTwoFactor: boolean, asked: string[] = []): AdminRoleReader {
  return async (adminUserId): Promise<AdminRoleResolution> => {
    asked.push(adminUserId);
    return {
      role: {
        id: 'r1',
        code: 'accounting',
        name: 'Accounting',
        permissions: [],
        requiresTwoFactor,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    };
  };
}

describe('MfaPolicyResolver', () => {
  it('storefront: disabled by default when nothing is set', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), roleOf(false));
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
      roleOf(false),
    );
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: 'ch1' },
    );
    expect(p.totpEnforced).toBe(true);
    expect(p.totpEnabled).toBe(true);
  });

  it('organization enforcement is additive for customers', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(true), roleOf(false));
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
      roleOf(false),
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

/**
 * Issue #349 — a role's `requiresTwoFactor` is the administrator's equivalent of
 * an organization's enforcement: additive to `mfa.admin.totp_enforced`, read
 * for admin subjects only, and failing closed when the role cannot be read.
 */
describe('MfaPolicyResolver — the administrator role requirement', () => {
  const admin = { subjectType: 'admin', subjectId: 'a1' } as const;
  const ctx = { salesChannelId: null };

  it('enforces (and therefore enables) TOTP for a holder of a role that requires it', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), roleOf(true));
    const p = await resolver.resolve(admin, ctx);
    expect(p.totpEnforced).toBe(true);
    expect(p.totpEnabled).toBe(true);
  });

  it('changes nothing for a role that does not require it', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), roleOf(false));
    const p = await resolver.resolve(admin, ctx);
    expect(p).toMatchObject({ totpEnforced: false, totpEnabled: false });
  });

  it('keeps the platform-wide setting in force whatever the role says', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true }),
      fakeEmFactory(null),
      roleOf(false),
    );
    expect((await resolver.resolve(admin, ctx)).totpEnforced).toBe(true);
  });

  it('fails closed when the role read throws', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), async () => {
      throw new Error('admin_roles unavailable');
    });
    expect((await resolver.resolve(admin, ctx)).totpEnforced).toBe(true);
  });

  it('fails closed when the role read answers a refusal', async () => {
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), async () => ({
      refusal: new Error('ADMIN_ROLE_REQUIRED'),
    }));
    expect((await resolver.resolve(admin, ctx)).totpEnforced).toBe(true);
  });

  it('never reads a role for a customer subject', async () => {
    const asked: string[] = [];
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), roleOf(true, asked));
    const p = await resolver.resolve({ subjectType: 'customer', subjectId: 'c1' }, ctx);
    expect(p.totpEnforced).toBe(false);
    expect(asked).toEqual([]);
  });

  it('reads no role for the anonymous provider list, which names no administrator', async () => {
    const asked: string[] = [];
    const resolver = new MfaPolicyResolver(fakeSettings({}), fakeEmFactory(null), roleOf(true, asked));
    await resolver.resolve({ subjectType: 'admin', subjectId: '' }, ctx);
    expect(asked).toEqual([]);
  });
});

/**
 * Issue #930 — without `MFA_SECRET_ENCRYPTION_KEY` this module serves no
 * enrolment route, so `mfa.admin.totp_enforced` demands a setup that nothing
 * can complete: every administrator without a factor is locked out. Where no
 * second factor can be enrolled, no administrator requirement is in force —
 * the setting, and since issue #948 a role's flag too; storefront and
 * organization enforcement are unchanged here.
 */
describe('MfaPolicyResolver — no second factor can be enrolled (issue #930)', () => {
  const noDefaultChannel = async (): Promise<string | null> => null;

  it('does not enforce mfa.admin.totp_enforced on an administrator', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true }),
      fakeEmFactory(null),
      roleOf(false),
      noDefaultChannel,
      false,
    );
    const p = await resolver.resolve(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null },
    );
    expect(p.totpEnforced).toBe(false);
  });

  it('still enforces the setting where a factor can be enrolled', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true }),
      fakeEmFactory(null),
      roleOf(false),
      noDefaultChannel,
      true,
    );
    const p = await resolver.resolve(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null },
    );
    expect(p.totpEnforced).toBe(true);
    expect(p.totpEnabled).toBe(true);
  });

  // Issue #947 — the same predicate for customers: neither the storefront
  // setting nor an organization's policy is applied without a key.
  it('does not enforce mfa.storefront.totp_enforced on a customer', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED]: true }),
      fakeEmFactory(null),
      roleOf(false),
      noDefaultChannel,
      false,
    );
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: 'ch1', organizationId: 'org1' },
    );
    expect(p.totpEnforced).toBe(false);
    expect(p.totpEnabled).toBe(false);
  });

  it("does not enforce an organization's policy on its members either", async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({}),
      fakeEmFactory(true),
      roleOf(false),
      noDefaultChannel,
      false,
    );
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: 'ch1', organizationId: 'org1' },
    );
    expect(p.totpEnforced).toBe(false);
  });

  it('still enforces storefront and organization requirements where a factor can be enrolled', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED]: false }),
      fakeEmFactory(true),
      roleOf(false),
      noDefaultChannel,
      true,
    );
    const p = await resolver.resolve(
      { subjectType: 'customer', subjectId: 'c1' },
      { salesChannelId: 'ch1', organizationId: 'org1' },
    );
    expect(p.totpEnforced).toBe(true);
  });

  // Issue #948, owner ruling Q6 (2026-11-08): without a key nothing is
  // enforced on an administrator, a role's requirement included.
  it("does not enforce a role's requirement either", async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({}),
      fakeEmFactory(null),
      roleOf(true),
      noDefaultChannel,
      false,
    );
    const p = await resolver.resolve(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null },
    );
    expect(p.totpEnforced).toBe(false);
  });

  it('does not enforce on an unreadable role either: the fail-closed read is moot without a key', async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({ [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true }),
      fakeEmFactory(null),
      async () => {
        throw new Error('admin_roles unavailable');
      },
      noDefaultChannel,
      false,
    );
    const p = await resolver.resolve(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null },
    );
    expect(p.totpEnforced).toBe(false);
  });

  it("still enforces a role's requirement where a factor can be enrolled", async () => {
    const resolver = new MfaPolicyResolver(
      fakeSettings({}),
      fakeEmFactory(null),
      roleOf(true),
      noDefaultChannel,
      true,
    );
    const p = await resolver.resolve(
      { subjectType: 'admin', subjectId: 'a1' },
      { salesChannelId: null },
    );
    expect(p.totpEnforced).toBe(true);
  });
});
