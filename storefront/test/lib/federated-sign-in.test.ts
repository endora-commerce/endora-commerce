import { describe, expect, it } from 'vitest';
import {
  resolveFederatedSignIn,
  type FederatedProvider,
} from '../../lib/federated-sign-in';

/**
 * Issue #193 — the decision behind the federated buttons, as a pure function.
 *
 * The rule the owner set: a button renders only when `mfa` is present AND that
 * provider is configured AND enabled. Everything else renders nothing — and
 * "nothing yet" has to be distinguishable from "nothing ever", because a
 * button that appears and then vanishes is the defect, not the fix.
 */
const BOTH: readonly FederatedProvider[] = ['google', 'microsoft'];

describe('resolveFederatedSignIn', () => {
  it('offers both providers when mfa is present and both are available', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: BOTH }),
    ).toEqual({ status: 'ready', providers: BOTH });
  });

  it('offers exactly the one provider the server reported', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: ['google'] }),
    ).toEqual({ status: 'ready', providers: ['google'] });
  });

  it('offers nothing when no provider is configured and enabled', () => {
    // The default deployment: both `mfa.storefront.*_enabled` settings are
    // `false`, so the server lists no provider and the block is absent.
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: [] }),
    ).toEqual({ status: 'none', providers: [] });
  });

  it('offers nothing when mfa is switched off, even with providers listed', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: false, availableProviders: BOTH }),
    ).toEqual({ status: 'none', providers: [] });
  });

  it('decides `none` from absence alone, without waiting for the provider read', () => {
    // `mfa` owns the availability endpoint, so waiting on it would only delay a
    // decision presence has already made.
    expect(
      resolveFederatedSignIn({ modulePresent: false, availableProviders: undefined }),
    ).toEqual({ status: 'none', providers: [] });
  });

  it('is `unknown` — not `none`, and never `ready` — while presence is pending', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: undefined, availableProviders: BOTH }),
    ).toEqual({ status: 'unknown', providers: [] });
  });

  it('is `unknown` while the provider read is pending', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: undefined }),
    ).toEqual({ status: 'unknown', providers: [] });
  });
});
