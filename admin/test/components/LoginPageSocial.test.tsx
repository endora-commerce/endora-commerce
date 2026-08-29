import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  FederatedSignInOptionsResponse,
  StorefrontModulePresenceResponse,
} from '@endora-commerce/contracts';

/**
 * Feature 042 / US5 — the admin login screen's federated sign-in buttons.
 * Issue #193 — and they are **absent**, not greyed out, whenever the platform
 * cannot complete the sign-in: `mfa` switched off, or the provider not
 * configured-and-enabled. Both provider settings default to `false`, so the
 * screen used to advertise two dead routes on every default install.
 *
 * The two reads are stubbed at the HTTP client, one level below the hook, so
 * the loading gap and the error paths are exercised rather than asserted away.
 */
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    login: vi.fn(),
    verifyMfa: vi.fn(),
    cancelMfa: vi.fn(),
    status: 'unauthenticated',
    lastLoginError: null,
    mfaChallengeId: null,
  }),
}));

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (path: string) => get(path),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const { LoginPage } = await import('../../src/components/LoginPage');

const PRESENCE = '/api/v1/storefront/module-presence';
const OPTIONS = '/api/v1/auth/admin/oauth/providers';

function presence(present: boolean): StorefrontModulePresenceResponse {
  return { modules: [{ id: 'mfa', present }, { id: 'catalog', present: true }] };
}
function options(
  ...providers: FederatedSignInOptionsResponse['providers']
): FederatedSignInOptionsResponse {
  return { providers };
}

/** Resolve the two reads with the given answers; anything else rejects. */
function stub(answers: { presence?: unknown; options?: unknown }): void {
  get.mockImplementation(async (path: string) => {
    if (path === PRESENCE) {
      if (answers.presence === undefined) throw new Error('presence unavailable');
      return answers.presence;
    }
    if (path === OPTIONS) {
      if (answers.options === undefined) throw new Error('options unavailable');
      return answers.options;
    }
    throw new Error(`unexpected path ${path}`);
  });
}

beforeEach(() => {
  get.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage — federated sign-in buttons', () => {
  it('renders both providers when mfa is present and both are enabled', async () => {
    stub({ presence: presence(true), options: options('google', 'microsoft') });
    const { container } = render(<LoginPage />);

    await screen.findByText('Continue with Google');
    expect(screen.getByText('Continue with Microsoft')).toBeTruthy();
    const google = container.querySelector(
      'a[data-provider="google"]',
    ) as HTMLAnchorElement;
    expect(google.getAttribute('href')).toContain('/api/v1/auth/admin/oauth/google/start');
  });

  it('renders only the enabled provider, with the divider still in place', async () => {
    // One button under a password form still needs the rule: without it the
    // lone bordered button reads as a second step rather than another route.
    stub({ presence: presence(true), options: options('google') });
    const { container } = render(<LoginPage />);

    await screen.findByText('Continue with Google');
    expect(screen.queryByText('Continue with Microsoft')).toBeNull();
    expect(container.querySelector('a[data-provider="microsoft"]')).toBeNull();
    expect(screen.getByText('or')).toBeTruthy();
  });

  it('renders no federated block — and no orphan divider — when none is enabled', async () => {
    // The default deployment. This is the defect the issue is about.
    stub({ presence: presence(true), options: options() });
    const { container } = render(<LoginPage />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(OPTIONS));
    await waitFor(() => expect(container.querySelector('[role="group"]')).toBeNull());
    expect(container.querySelector('a[data-provider]')).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
    // The password form is untouched by any of this.
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('renders no federated block when mfa is switched off, even with providers enabled', async () => {
    stub({ presence: presence(false), options: options('google', 'microsoft') });
    const { container } = render(<LoginPage />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(PRESENCE));
    await waitFor(() => expect(container.querySelector('a[data-provider]')).toBeNull());
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
  });

  it('renders nothing during the loading gap, and never a button that then vanishes', async () => {
    // Both reads hang. The password form must already be usable; the federated
    // slot must be empty rather than optimistic or skeletoned.
    get.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<LoginPage />);

    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(container.querySelector('a[data-provider]')).toBeNull();
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
  });

  it('fails closed when either read errors', async () => {
    // Unreachable, 503 from a gated module, or an endpoint this deployment has
    // not rolled out yet — all the same answer: no federated route offered.
    stub({ presence: presence(true) });
    const { container } = render(<LoginPage />);

    await waitFor(() => expect(get).toHaveBeenCalledWith(OPTIONS));
    await waitFor(() => expect(container.querySelector('a[data-provider]')).toBeNull());
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('labels the group and hides the decorative rule from assistive tech', async () => {
    stub({ presence: presence(true), options: options('google', 'microsoft') });
    const { container } = render(<LoginPage />);

    const group = await screen.findByRole('group', { name: 'Other sign-in options' });
    expect(group).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"] span')?.textContent).toBe('or');
  });
});
