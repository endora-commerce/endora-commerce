import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ERROR_CODES, MFA_SETTING_CODES } from '@endora-commerce/contracts';
import type { AdminRoleResolution, MfaLoginContext, MfaSubjectRef } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { MfaPolicyResolver, type AdminRoleReader, type SettingsReader } from './mfa-policy-resolver.js';
import { FactorRemovalGuard } from './factor-removal-guard.js';

/**
 * Issue #935 — removing one's own last second factor is refused while any
 * source requires one: `mfa.admin.totp_enforced`, an administrator role's
 * `requiresTwoFactor`, `mfa.storefront.totp_enforced` at the request's channel,
 * or the customer's organization policy. The guard reads the requirement
 * through the same `MfaPolicyResolver` the sign-in decision reads, so no source
 * is stricter here than it is there, and none is in force without an
 * encryption key (PR #981).
 */

/** Values per `code@channel`, or per `code` for every channel. */
function fakeSettings(values: Record<string, boolean>): SettingsReader {
  return {
    async get<T>(code: string, channel: string | null, schema: z.ZodType<T>): Promise<T> {
      const scoped = `${code}@${channel ?? ''}`;
      if (scoped in values) return schema.parse(values[scoped]);
      if (code in values) return schema.parse(values[code]);
      throw new Error('SettingNotRegistered');
    },
  };
}

function fakeEmFactory(enforceTotp: boolean | null) {
  return () =>
    ({
      async findOne() {
        return enforceTotp === null ? null : { enforceTotp };
      },
    }) as never;
}

function roleOf(requiresTwoFactor: boolean): AdminRoleReader {
  return async (): Promise<AdminRoleResolution> => ({
    role: {
      id: 'r1',
      code: 'accounting',
      name: 'Accounting',
      permissions: [],
      requiresTwoFactor,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  });
}

interface Sources {
  settings?: Record<string, boolean>;
  orgEnforced?: boolean | null;
  roleRequires?: boolean;
  hasKey?: boolean;
  activeFactors?: number;
}

function guardFor(sources: Sources): FactorRemovalGuard {
  const resolver = new MfaPolicyResolver(
    fakeSettings(sources.settings ?? {}),
    fakeEmFactory(sources.orgEnforced ?? null),
    roleOf(sources.roleRequires ?? false),
    async () => null,
    sources.hasKey ?? true,
  );
  return new FactorRemovalGuard(resolver, async () => sources.activeFactors ?? 1);
}

const ADMIN: MfaSubjectRef = { subjectType: 'admin', subjectId: 'a1' };
const CUSTOMER: MfaSubjectRef = { subjectType: 'customer', subjectId: 'c1' };
const ADMIN_CTX: MfaLoginContext = { salesChannelId: null };
const CUSTOMER_CTX: MfaLoginContext = { salesChannelId: 'ch-b2b', organizationId: 'org1' };

const REFUSED = { canDisable: false, disableBlockedReason: 'factor_required' };
const ALLOWED = { canDisable: true, disableBlockedReason: null };

async function refusal(guard: FactorRemovalGuard, subject: MfaSubjectRef, ctx: MfaLoginContext) {
  try {
    await guard.assertMayRemove(subject, ctx);
  } catch (error) {
    return error;
  }
  return null;
}

describe('FactorRemovalGuard — one source at a time', () => {
  const cases: Array<{ name: string; subject: MfaSubjectRef; ctx: MfaLoginContext; sources: Sources }> = [
    {
      name: 'admin: mfa.admin.totp_enforced',
      subject: ADMIN,
      ctx: ADMIN_CTX,
      sources: { settings: { [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true } },
    },
    { name: "admin: the role's requiresTwoFactor", subject: ADMIN, ctx: ADMIN_CTX, sources: { roleRequires: true } },
    {
      name: "customer: mfa.storefront.totp_enforced at the request's channel",
      subject: CUSTOMER,
      ctx: CUSTOMER_CTX,
      sources: { settings: { [`${MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED}@ch-b2b`]: true } },
    },
    { name: "customer: the organization's policy", subject: CUSTOMER, ctx: CUSTOMER_CTX, sources: { orgEnforced: true } },
  ];

  for (const c of cases) {
    it(`refuses removing the last factor — ${c.name}`, async () => {
      const guard = guardFor(c.sources);
      expect(await guard.verdict(c.subject, c.ctx)).toEqual(REFUSED);
      const error = await refusal(guard, c.subject, c.ctx);
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(409);
      expect((error as HttpError).code).toBe(ERROR_CODES.MFA_LAST_FACTOR_REQUIRED);
    });

    it(`allows it while another factor remains — ${c.name}`, async () => {
      const guard = guardFor({ ...c.sources, activeFactors: 2 });
      expect(await guard.verdict(c.subject, c.ctx)).toEqual(ALLOWED);
      expect(await refusal(guard, c.subject, c.ctx)).toBeNull();
    });

    it(`allows it without an encryption key, where the requirement is not in force — ${c.name}`, async () => {
      const guard = guardFor({ ...c.sources, hasKey: false });
      expect(await guard.verdict(c.subject, c.ctx)).toEqual(ALLOWED);
      expect(await refusal(guard, c.subject, c.ctx)).toBeNull();
    });
  }
});

describe('FactorRemovalGuard — what does not require a factor', () => {
  it('allows removing the last factor when nothing requires one', async () => {
    expect(await guardFor({}).verdict(ADMIN, ADMIN_CTX)).toEqual(ALLOWED);
    expect(await guardFor({}).verdict(CUSTOMER, CUSTOMER_CTX)).toEqual(ALLOWED);
  });

  it('reads the storefront setting at the request channel, not at another one', async () => {
    const guard = guardFor({
      settings: { [`${MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED}@ch-other`]: true },
    });
    expect(await guard.verdict(CUSTOMER, CUSTOMER_CTX)).toEqual(ALLOWED);
  });

  it('does not apply an administrator source to a customer, nor a customer source to an administrator', async () => {
    const adminSources = guardFor({
      settings: { [MFA_SETTING_CODES.ADMIN_TOTP_ENFORCED]: true },
      roleRequires: true,
    });
    expect(await adminSources.verdict(CUSTOMER, CUSTOMER_CTX)).toEqual(ALLOWED);
    const customerSources = guardFor({
      settings: { [MFA_SETTING_CODES.STOREFRONT_TOTP_ENFORCED]: true },
      orgEnforced: true,
    });
    expect(await customerSources.verdict(ADMIN, { salesChannelId: null, organizationId: 'org1' })).toEqual(
      ALLOWED,
    );
  });

  it('has nothing to refuse when there is no factor to remove', async () => {
    const guard = guardFor({ roleRequires: true, activeFactors: 0 });
    expect(await refusal(guard, ADMIN, ADMIN_CTX)).toBeNull();
  });
});
