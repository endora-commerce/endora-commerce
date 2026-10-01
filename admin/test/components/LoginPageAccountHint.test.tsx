import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from '../../../packages/admin-shell/src/components/LoginPage';

vi.mock('../../../packages/admin-shell/src/lib/auth', () => ({
  useAuth: () => ({
    login: vi.fn(),
    lastLoginError: null,
    status: 'unauthenticated',
  }),
}));

/**
 * The hint below the form is read in every setting the shell is mounted in —
 * this repository, a scaffolded instance, a production image — and it used to
 * name `pnpm --filter backend run admin:create`, a command only the first of
 * them has. It must name no command at all, and link to the guide that names
 * the right one for each.
 */
describe('LoginPage account hint', () => {
  it('names no setting-specific command', () => {
    const { container } = render(<LoginPage />);
    expect(container.textContent).not.toMatch(/pnpm|--filter|admin:create|repository root/);
  });

  it('points at the administrator section of the getting-started guide', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: /getting started/i });
    expect(link.getAttribute('href')).toBe(
      'https://docs.commerce.endora.software/getting-started#creating-an-administrator',
    );
    expect(screen.getByText(/ask your platform administrator/i)).toBeTruthy();
  });
});
