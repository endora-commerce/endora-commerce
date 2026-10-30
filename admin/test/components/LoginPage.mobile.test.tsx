import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from '../../../packages/admin-shell/src/components/LoginPage';

vi.mock('@endora-commerce/admin-kit/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/lib')>()),
  useAuth: () => ({
    login: vi.fn(),
    lastLoginError: null,
    status: 'unauthenticated',
  }),
}));

describe('LoginPage mobile layout', () => {
  it('renders submit control with comfortable tap height', () => {
    render(<LoginPage />);
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit.className).toMatch(/min-h-11/);
  });
});
