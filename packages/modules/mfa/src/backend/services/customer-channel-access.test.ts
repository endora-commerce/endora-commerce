/**
 * Feature 154 (owner decision D6) — whether a federated sign-in may create a
 * new account on the channel it was started on. Creating an individual account
 * is what an anonymous visitor does, so it follows the anonymous half of the
 * access rule: allowed only on a channel open to anonymous visitors, exactly as
 * individual self-registration is.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SalesChannelAccessPort, SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import { createCustomerChannelAccess } from './customer-channel-access.js';

type Decision = Awaited<ReturnType<SalesChannelAccessPort['decide']>>;
/** The channel as the resolution port answers it; the rule reads `anonymousAccess` alone. */
type Channel = NonNullable<Awaited<ReturnType<SalesChannelResolutionPort['getById']>>>;

const OPEN = { id: 'ch-open', code: 'open', anonymousAccess: true } as Channel;
const CLOSED = { id: 'ch-closed', code: 'closed', anonymousAccess: false } as Channel;

function build() {
  const decide = vi.fn(
    async (actor: { kind: string }, channel: { anonymousAccess: boolean }): Promise<Decision> =>
      actor.kind === 'anonymous' && !channel.anonymousAccess
        ? { ok: false, code: 'SALES_CHANNEL_SIGN_IN_REQUIRED' }
        : { ok: true },
  );
  const getById = vi.fn(async (id: string) => [OPEN, CLOSED].find((c) => c.id === id) ?? null);
  const access = createCustomerChannelAccess(
    { findById: async () => null },
    { decide, assertCustomerMayUse: async () => undefined },
    { getById },
  );
  return { access, decide, getById };
}

describe('CustomerChannelAccess.admitsNewAccount', () => {
  it('admits a new account on a channel open to anonymous visitors', async () => {
    const { access, decide } = build();
    expect(await access.admitsNewAccount(OPEN.id)).toBe(true);
    expect(decide).toHaveBeenCalledWith({ kind: 'anonymous' }, OPEN);
  });

  it('refuses a new account on a channel closed to anonymous visitors', async () => {
    const { access } = build();
    expect(await access.admitsNewAccount(CLOSED.id)).toBe(false);
  });

  it('refuses when the sign-in was started on no channel, or on one that no longer exists', async () => {
    const { access, getById } = build();
    expect(await access.admitsNewAccount(null)).toBe(false);
    expect(getById).not.toHaveBeenCalled();
    expect(await access.admitsNewAccount('gone')).toBe(false);
  });
});
