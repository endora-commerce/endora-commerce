import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

/**
 * Feature 042 / US5 — admin LoginPage renders the federated sign-in buttons
 * (Google / Microsoft) linking to the admin OAuth start endpoints.
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

const { LoginPage } = await import('../../src/components/LoginPage');

describe('LoginPage — social sign-in buttons', () => {
  it('renders Google + Microsoft links to the admin OAuth start endpoints', () => {
    const { container, getByText } = render(<LoginPage />);
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with Microsoft')).toBeTruthy();
    const google = container.querySelector('a[data-provider="google"]') as HTMLAnchorElement;
    expect(google.getAttribute('href')).toContain('/api/v1/auth/admin/oauth/google/start');
  });
});
