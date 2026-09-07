import { describe, expect, it } from 'vitest';
import {
  resolveFederatedSignIn,
  type FederatedProvider,
} from '../../../packages/admin-shell/src/lib/federated-sign-in/resolve';

/**
 * Issue #193 — the decision behind the admin login screen's federated buttons.
 * Same rule as the storefront's, kept as a pure function so every state is
 * pinned without mounting the screen.
 */
const BOTH: readonly FederatedProvider[] = ['google', 'microsoft'];

describe('resolveFederatedSignIn (admin)', () => {
  it('offers both providers when mfa is present and both are available', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: BOTH }),
    ).toEqual({ status: 'ready', providers: BOTH });
  });

  it('offers exactly one provider when only one is configured and enabled', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: ['microsoft'] }),
    ).toEqual({ status: 'ready', providers: ['microsoft'] });
  });

  it('offers nothing on a default deployment, where both settings are false', () => {
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
    expect(
      resolveFederatedSignIn({ modulePresent: false, availableProviders: undefined }),
    ).toEqual({ status: 'none', providers: [] });
  });

  it('is `unknown` while either input is pending, and never `ready`', () => {
    expect(
      resolveFederatedSignIn({ modulePresent: undefined, availableProviders: BOTH }),
    ).toEqual({ status: 'unknown', providers: [] });
    expect(
      resolveFederatedSignIn({ modulePresent: true, availableProviders: undefined }),
    ).toEqual({ status: 'unknown', providers: [] });
  });
});
