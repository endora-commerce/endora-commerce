import { describe, expect, it } from 'vitest';
import { completeCustomerSignIn, type OrganizationsPublicDeps } from './routes.public.js';

/**
 * Issue #1188 — the post-sign-in step names the sign-in's sales channel to the
 * hook when the caller knows it and its request does not: `mfa`'s federated
 * callback is the provider's redirect, so it passes the channel the sign-in
 * was started on, and only the signed-out basket of that store is merged.
 * Every other sign-in passes none, and the hook keeps reading the request's
 * resolved channel.
 */

type HookInput = Parameters<NonNullable<OrganizationsPublicDeps['onLogin']>>[0];

function recordingHook(): { onLogin: NonNullable<OrganizationsPublicDeps['onLogin']>; calls: HookInput[] } {
  const calls: HookInput[] = [];
  return {
    calls,
    onLogin: async (input) => {
      calls.push(input);
      return {};
    },
  };
}

const log = { error: () => undefined };

describe('completeCustomerSignIn — the sign-in channel (#1188)', () => {
  it('hands a named channel to the hook beside the anonymous basket', async () => {
    const { onLogin, calls } = recordingHook();
    await completeCustomerSignIn(onLogin, {
      customerAccountId: 'c1',
      organizationId: 'o1',
      cookies: { b2b_cart_anon: 'anon-1' },
      log,
      salesChannelId: 'channel-a',
    });
    expect(calls).toEqual([
      { customerAccountId: 'c1', organizationId: 'o1', anonymousCartToken: 'anon-1', salesChannelId: 'channel-a' },
    ]);
  });

  it.each([null, undefined])('names no channel for %s, so the hook reads the request one', async (salesChannelId) => {
    const { onLogin, calls } = recordingHook();
    await completeCustomerSignIn(onLogin, {
      customerAccountId: 'c1',
      organizationId: 'o1',
      cookies: { b2b_cart_anon: 'anon-1' },
      log,
      ...(salesChannelId === null ? { salesChannelId } : {}),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('salesChannelId');
  });
});
