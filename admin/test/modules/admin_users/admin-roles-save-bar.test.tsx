import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import AdminRolesPage from '../../../../packages/modules/admin_users/src/admin/pages/AdminRolesPage';

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; SHELL-13) — the role editor's Save sits in the
 * kit's sticky bar at the end of the form, where it stays in view over a long permission list,
 * and the red Delete is no longer beside it: it moved to the top of the editor, the whole form
 * away from the primary (Fitts: destructive actions get distance). The save's refusal and its
 * outcome are said in the bar, next to the button that caused them.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const EN = shippedCoreBundle('en');
const core = EN.core!;

const ROLE = {
  id: '00000000-0000-4000-8000-0000000000aa',
  code: 'accounting',
  name: 'Accounting',
  permissions: ['orders:read'],
  requiresTwoFactor: false,
  updatedAt: '2026-11-07T00:00:00.000Z',
};

const PERMISSIONS = [
  { code: 'orders:read', module: 'orders', label: 'Read orders', owners: ['orders'] },
  { code: 'orders:write', module: 'orders', label: 'Write orders', owners: ['orders'] },
];

function mockApi(): void {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/admin-roles') return { data: [ROLE] } as never;
    if (url === '/api/v1/admin/permissions') return { data: PERMISSIONS } as never;
    throw new Error(`unexpected GET ${url}`);
  });
}

function saveBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('[data-slot="sticky-form-actions"]');
  if (bar === null) throw new Error('no save bar');
  return bar;
}

async function openRole(): Promise<void> {
  mockApi();
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <AdminRolesPage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['admin_users'] }) },
    ),
    EN,
  );
  fireEvent.click(await screen.findByText('accounting'));
  await screen.findByRole('button', { name: core['adminRoles.save']! });
}

describe('AdminRolesPage — the one Save in the sticky bar', () => {
  afterEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('puts Save in the sticky bar and keeps Delete out of it', async () => {
    await openRole();
    const bar = saveBar();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    expect(within(bar).getByRole('button', { name: core['adminRoles.save']! })).toHaveAttribute('type', 'submit');
    expect(within(bar).queryByRole('button', { name: core['adminRoles.delete']! })).toBeNull();
    const del = screen.getByRole('button', { name: core['adminRoles.delete']! });
    // Delete comes before the form in the document; Save is its last control.
    const form = bar.closest('form')!;
    expect(form).not.toContainElement(del);
    expect(del.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says "Unsaved changes" in the bar once a permission is ticked', async () => {
    await openRole();
    const hint = within(saveBar()).getByTestId('unsaved-changes-hint');
    expect(hint).toHaveTextContent('');
    fireEvent.click(screen.getByRole('checkbox', { name: /orders:write/ }));
    expect(hint).toHaveTextContent(core['form.unsavedChanges.hint']!);
  });

  it('reports a refused save in the bar, not at the top of the page', async () => {
    await openRole();
    vi.mocked(apiClient.put).mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'The role changed meanwhile.' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: core['adminRoles.save']! }));
    const alert = within(saveBar()).getByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('The role changed meanwhile.'));
  });

  it('says the role was saved in the bar', async () => {
    await openRole();
    vi.mocked(apiClient.put).mockResolvedValue({ data: { ...ROLE, signedOutAdministrators: 0 } } as never);
    fireEvent.click(screen.getByRole('button', { name: core['adminRoles.save']! }));
    await waitFor(() =>
      expect(within(saveBar()).getByRole('status')).toHaveTextContent(
        core['adminRoles.info.saved']!.replace('{code}', 'accounting'),
      ),
    );
  });
});
