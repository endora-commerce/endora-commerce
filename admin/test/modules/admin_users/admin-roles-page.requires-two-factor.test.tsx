import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #349, interim step: the role editor no longer offers the per-role
 * "requires two-step verification" checkbox.
 *
 * `AdminRole.requiresTwoFactor` is stored but nothing reads it at sign-in, so
 * the checkbox promised an enforcement that never happened. The setting that
 * does require administrators' second factor is `mfa.admin.totp_enforced`.
 * The contract field stays (optional on PUT) until the breaking release, so a
 * save that omits it keeps whatever value the role already stores.
 */

const put = vi.fn(async () => ({ data: {} }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (url: string) =>
        url.endsWith('/admin-roles')
          ? {
              data: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  code: 'editor',
                  name: 'Editor',
                  permissions: ['orders:read'],
                  requiresTwoFactor: true,
                  updatedAt: '2026-11-07T00:00:00.000Z',
                },
              ],
            }
          : {
              data: [
                { code: 'orders:read', module: 'orders', label: 'Read orders', owners: ['orders'] },
              ],
            },
      ),
      post: vi.fn(),
      put,
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { default: AdminRolesPage } = await import(
  '../../../../packages/modules/admin_users/src/admin/pages/AdminRolesPage'
);

/** The shipped English `core` bundle, so the label is matched as an operator reads it. */
const core = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;

describe('AdminRolesPage — per-role two-factor flag (#349)', () => {
  it('renders no requires-two-factor checkbox and does not send the flag on save', async () => {
    renderWithI18n(
      <MemoryRouter>
        <AdminRolesPage />
      </MemoryRouter>,
      { core },
    );

    fireEvent.click(await screen.findByRole('button', { name: /editor/i }));
    // Positive control: the editor is open.
    expect(await screen.findByLabelText(core['adminRoles.field.displayName']!)).toBeTruthy();

    expect(screen.queryByText(/two-step verification/i)).toBeNull();
    expect(screen.queryByText(/requires2fa/)).toBeNull();

    fireEvent.submit(document.querySelector('form')!);
    expect(put).toHaveBeenCalledTimes(1);
    const body = (put.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(body).not.toHaveProperty('requiresTwoFactor');
  });
});
