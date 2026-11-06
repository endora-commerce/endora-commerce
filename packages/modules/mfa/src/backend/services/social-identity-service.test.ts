/**
 * Federated sign-in resolves a provider identity to an account the way the
 * password sign-in does: a blocked customer account is refused, before any link
 * is written or any audit entry recorded, and the account's organisation travels
 * with the answer so the second-factor policy can be resolved for it.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { SocialIdentityService, type SocialIdentityDeps } from './social-identity-service.js';
import type { OAuthIdentity } from './oauth-provider-service.js';

const IDENTITY: OAuthIdentity = {
  provider: 'google',
  sub: 'sub-1',
  email: 'buyer@example.com',
  emailVerified: true,
};

/** The OAuth transaction's channel: the store the sign-in was started on. */
const ON_B = { salesChannelId: 'channel-b' };

function harness(
  deps: Partial<SocialIdentityDeps>,
  admitsNewAccount: (salesChannelId: string | null) => Promise<boolean> = async () => true,
): {
  service: SocialIdentityService;
  persisted: unknown[];
  audited: unknown[];
} {
  const persisted: unknown[] = [];
  const audited: unknown[] = [];
  const em = {
    findOne: async () => null,
    create: (_entity: unknown, data: unknown) => data,
    persist: (row: unknown) => {
      persisted.push(row);
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
  const audit = {
    record: async (entry: unknown) => {
      audited.push(entry);
    },
  } as unknown as AuditPort;
  const service = new SocialIdentityService(
    () => em,
    {
      resolveCustomerByEmail: async () => null,
      autoCreateCustomer: async () => null,
      resolveAdminByEmail: async () => null,
      ...deps,
    },
    audit,
    { admitsNewAccount },
  );
  return { service, persisted, audited };
}

describe('SocialIdentityService.signInCustomer', () => {
  it('refuses a blocked customer account and records no link', async () => {
    const autoCreateCustomer = vi.fn(async () => ({ id: 'other' }));
    const { service, persisted, audited } = harness({
      resolveCustomerByEmail: async () => ({ id: 'c1', organizationId: 'o1', blocked: true }),
      autoCreateCustomer,
    });

    expect(await service.signInCustomer(IDENTITY, ON_B)).toEqual({ ok: false, reason: 'blocked' });
    expect(persisted).toEqual([]);
    expect(audited).toEqual([]);
    // A blocked account is an account: it is never answered by creating another.
    expect(autoCreateCustomer).not.toHaveBeenCalled();
  });

  it('signs in an active customer and answers with its organisation', async () => {
    const { service, persisted } = harness({
      resolveCustomerByEmail: async () => ({ id: 'c1', organizationId: 'o1', blocked: false }),
    });

    expect(await service.signInCustomer(IDENTITY, ON_B)).toEqual({
      ok: true,
      subjectId: 'c1',
      organizationId: 'o1',
    });
    expect(persisted).toHaveLength(1);
  });

  it('answers an auto-created account with the organisation it was created in', async () => {
    const { service } = harness({
      autoCreateCustomer: async () => ({ id: 'c2', organizationId: 'o2' }),
    });

    expect(await service.signInCustomer(IDENTITY, ON_B)).toEqual({
      ok: true,
      subjectId: 'c2',
      organizationId: 'o2',
    });
  });
});

describe('SocialIdentityService.signInCustomer — the started-on channel (feature 154, D6)', () => {
  it('creates the account for the channel the sign-in was started on', async () => {
    const autoCreateCustomer = vi.fn(async () => ({ id: 'c2', organizationId: 'o2' }));
    const admits = vi.fn(async () => true);
    const { service } = harness({ autoCreateCustomer }, admits);

    await service.signInCustomer(IDENTITY, ON_B);

    expect(admits).toHaveBeenCalledWith('channel-b');
    expect(autoCreateCustomer).toHaveBeenCalledWith('buyer@example.com', {
      salesChannelId: 'channel-b',
    });
  });

  it('refuses to create an account on a channel closed to anonymous visitors', async () => {
    const autoCreateCustomer = vi.fn(async () => ({ id: 'c2', organizationId: 'o2' }));
    const { service, persisted, audited } = harness({ autoCreateCustomer }, async () => false);

    expect(await service.signInCustomer(IDENTITY, ON_B)).toEqual({
      ok: false,
      reason: 'sales_channel_sign_in_required',
    });
    expect(autoCreateCustomer).not.toHaveBeenCalled();
    expect(persisted).toEqual([]);
    expect(audited).toEqual([]);
  });

  // Issue #789 (from #785) — `autoCreate` answers null only when personal (org-less)
  // registration is off on the started-on channel, so the refusal names that, not a missing account.
  it('names a channel with personal registration off when no account may be created', async () => {
    const { service, persisted, audited } = harness({ autoCreateCustomer: async () => null });

    expect(await service.signInCustomer(IDENTITY, ON_B)).toEqual({
      ok: false,
      reason: 'registration_disabled_in_channel',
    });
    expect(persisted).toEqual([]);
    expect(audited).toEqual([]);
  });

  it('refuses to create an account when the sign-in was started on no channel', async () => {
    const autoCreateCustomer = vi.fn(async () => ({ id: 'c2', organizationId: 'o2' }));
    const admits = vi.fn(async () => true);
    const { service } = harness({ autoCreateCustomer }, admits);

    expect(await service.signInCustomer(IDENTITY, { salesChannelId: null })).toEqual({
      ok: false,
      reason: 'sales_channel_sign_in_required',
    });
    expect(autoCreateCustomer).not.toHaveBeenCalled();
  });

  it('does not ask about the channel for an account that already exists', async () => {
    const admits = vi.fn(async () => false);
    const { service } = harness(
      { resolveCustomerByEmail: async () => ({ id: 'c1', organizationId: 'o1', blocked: false }) },
      admits,
    );

    expect(await service.signInCustomer(IDENTITY, ON_B)).toEqual({
      ok: true,
      subjectId: 'c1',
      organizationId: 'o1',
    });
    // Whether the existing account may use the store is the assignment rule's
    // answer, which the callback asks next.
    expect(admits).not.toHaveBeenCalled();
  });
});

describe('SocialIdentityService.signInAdmin', () => {
  it('answers with no organisation — administrators belong to none', async () => {
    const { service } = harness({ resolveAdminByEmail: async () => ({ id: 'a1' }) });
    expect(await service.signInAdmin(IDENTITY)).toEqual({
      ok: true,
      subjectId: 'a1',
      organizationId: null,
    });
  });
});
