import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

/**
 * Feature 042 / US2 — admin LoginPage renders the second-step code screen when
 * the auth context reports a pending MFA challenge, and calls `verifyMfa` on
 * submit.
 */
const verifyMfaSpy = vi.fn(async () => {});
const cancelMfaSpy = vi.fn();
const loginSpy = vi.fn(async () => {});

let mfaChallengeId: string | null = 'chal-1';

vi.mock('../../../packages/admin-shell/src/lib/auth', () => ({
  useAuth: () => ({
    login: loginSpy,
    verifyMfa: verifyMfaSpy,
    cancelMfa: cancelMfaSpy,
    status: 'unauthenticated',
    lastLoginError: null,
    mfaChallengeId,
  }),
}));

const { LoginPage } = await import('../../../packages/admin-shell/src/components/LoginPage');

describe('LoginPage — MFA second step', () => {
  beforeEach(() => {
    verifyMfaSpy.mockClear();
    cancelMfaSpy.mockClear();
  });

  it('shows the code screen and verifies on submit when a challenge is pending', () => {
    mfaChallengeId = 'chal-1';
    const { getByLabelText, getByText, container } = render(<LoginPage />);
    expect(getByText('Two-step verification')).toBeTruthy();
    const input = getByLabelText('Authentication code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456' } });
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    expect(verifyMfaSpy).toHaveBeenCalledWith('123456');
  });

  it('shows the password form when no challenge is pending', () => {
    mfaChallengeId = null;
    const { queryByText } = render(<LoginPage />);
    expect(queryByText('Two-step verification')).toBeNull();
  });
});
