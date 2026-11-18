import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/_i18n/i18n/en.json';
import returnsEn from '../../../../packages/modules/returns/i18n/en.json';
import { CASE_180 } from './return-detail-fixture';

/**
 * `specs/181-guest-complaints/` T048 (US3; FR-063, FR-072; contracts/admin-api.md A2, A3,
 * A5, A6): the detail of a guest's case — the *Guest* marking, the verified address and
 * when, how long the tracking link works, when the data is due for erasure — and the two
 * actions, each behind a `ConfirmDialog`: *Send a new tracking link* and, only for a
 * holder of `returns:erase_personal_data`, *Erase personal data*. A guest's comment is
 * labelled *Guest*.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    formatDateTime: (value: string) => `at ${value.slice(0, 10)}`,
    apiBaseUrl: 'https://api.example',
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnDetail } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnDetail');

const R = returnsEn as Record<string, string>;
const fill = (key: string, params: Record<string, string>) =>
  Object.entries(params).reduce((text, [k, v]) => text.replace(`{${k}}`, v), R[key]!);

const GUEST = {
  ...CASE_180,
  orderId: null,
  offPlatform: true,
  guest: true,
  customerAccountId: null as string | null,
  organizationId: null as string | null,
  purchase: { proofNumber: 'FV/181/2026', date: '2026-10-01' },
  contact: { name: 'Gość Kowalski', email: 'gosc@example.test', phone: null },
  returnAddress: { name: 'Gość Kowalski', street: 'Prosta 2', postalCode: '00-002', city: 'Warszawa', countryCode: 'PL' },
  attachments: [] as Array<Record<string, unknown>>,
  acceptedClauses: [],
  clausesAcceptedAt: null,
  personalDataErasedAt: null as string | null,
  contactVerifiedAt: '2026-11-01T09:00:00Z',
  trackingLinkValidUntil: null as string | null,
  guestDataErasureDueAt: null as string | null,
  comments: [
    { id: 'c1', authorKind: 'guest', body: 'Any news?', isCustomerVisible: true, notifyCustomer: false, createdAt: '2026-11-02T10:00:00Z' },
  ] as Array<Record<string, unknown>>,
};

let rc: typeof GUEST;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  rc = { ...GUEST };
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: rc });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    return Promise.resolve({ data: [] });
  });
  api.post.mockImplementation((path: string) => {
    if (path.endsWith('/guest/tracking-link')) return Promise.resolve({ data: { trackingVersion: 2 } });
    if (path.endsWith('/guest/erase')) {
      rc = { ...rc, contact: null as never, returnAddress: null as never, personalDataErasedAt: '2026-11-16T08:00:00Z' };
      return Promise.resolve({ data: { personalDataErasedAt: '2026-11-16T08:00:00Z' } });
    }
    return Promise.resolve({ data: {} });
  });
});

function renderDetail(permissions: readonly string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/returns/r1']}>
        <Routes>
          <Route path="/returns/:id" element={<ReturnDetail />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['returns'] }) },
    ),
    { core: en as Record<string, string>, returns: R },
  );
}

async function openMenu(): Promise<void> {
  fireEvent.pointerDown(await screen.findByRole('button', { name: R['detail.guest.actions']! }), { button: 0, ctrlKey: false });
}

describe('ReturnDetail — a guest’s case (181 T048)', () => {
  it('marks the case as a guest’s and shows the verified address, the link and the erasure lines', async () => {
    rc = { ...GUEST, trackingLinkValidUntil: null, guestDataErasureDueAt: null };
    renderDetail(['returns:read', 'returns:write']);
    expect((await screen.findAllByText(R['list.guest']!)).length).toBeGreaterThan(0);
    expect(screen.getByText(fill('detail.guest.verifiedEmail', { date: 'at 2026-11-01' }))).toBeInTheDocument();
    expect(screen.getByText(R['detail.guest.linkWhileOpen']!)).toBeInTheDocument();
    expect(screen.getByText(R['detail.guest.erasureAfterClose']!)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'gosc@example.test' })).toBeInTheDocument();
  });

  it('shows the dates once the case is closed', async () => {
    rc = { ...GUEST, trackingLinkValidUntil: '2027-02-14T10:00:00Z', guestDataErasureDueAt: '2027-02-14T10:00:00Z' };
    renderDetail(['returns:read', 'returns:write']);
    expect(await screen.findByText(fill('detail.guest.linkValidUntil', { date: 'at 2027-02-14' }))).toBeInTheDocument();
    expect(screen.getByText(fill('detail.guest.erasureDue', { date: 'at 2027-02-14' }))).toBeInTheDocument();
  });

  it('labels a guest’s comment as a guest’s', async () => {
    renderDetail(['returns:read', 'returns:write']);
    expect(await screen.findByText('Any news?')).toBeInTheDocument();
    const comment = screen.getByText('Any news?').parentElement!;
    expect(within(comment).getByText(R['comments.author.guest']!)).toBeInTheDocument();
  });

  it('sends a new tracking link after a confirmation', async () => {
    renderDetail(['returns:read', 'returns:write']);
    await openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: R['detail.guest.reissue']! }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(fill('detail.guest.reissueConfirm', { email: 'gosc@example.test' }))).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: R['detail.guest.reissueConfirmAction']! }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/r1/guest/tracking-link', {}));
    expect(await screen.findByText(R['detail.guest.reissued']!)).toBeInTheDocument();
  });

  it('offers no erasure without returns:erase_personal_data', async () => {
    renderDetail(['returns:read', 'returns:write']);
    // A labelled trigger on a detail page, not an icon alone (design review F-21).
    expect(await screen.findByRole('button', { name: R['detail.guest.actions']! })).toHaveTextContent(R['detail.guest.actions']!);
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: R['detail.guest.reissue']! })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: R['detail.guest.erase']! })).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('erases the personal data after an irreversible confirmation, and cancelling sends nothing', async () => {
    renderDetail(['returns:read', 'returns:write', 'returns:erase_personal_data']);
    await openMenu();
    // The irreversible item is set apart from the routine one (design review F-20).
    expect(await screen.findByRole('separator')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('menuitem', { name: R['detail.guest.erase']! }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(R['detail.guest.eraseConfirm']!)).toBeInTheDocument();
    // The irreversible question opens on *Cancel*, inside the dialog — the menu that opened
    // it does not take focus back behind the scrim (design review A-1).
    const cancel = within(dialog).getByRole('button', { name: en['common.action.cancel'] as string });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Closing gives focus back to the ⋮ that opened the dialog.
    await waitFor(() => expect(screen.getByRole('button', { name: R['detail.guest.actions']! })).toHaveFocus());
    expect(api.post).not.toHaveBeenCalled();

    await openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: R['detail.guest.erase']! }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: R['detail.guest.eraseConfirmAction']! }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/r1/guest/erase', { confirm: true }));
    expect(await screen.findByText(R['detail.guest.erasedInfo']!)).toBeInTheDocument();
    expect(screen.getByText(fill('detail.erased', { date: 'at 2026-11-16' }))).toBeInTheDocument();
  });

  it('offers neither action once the data is erased', async () => {
    rc = { ...GUEST, contact: null as never, returnAddress: null as never, personalDataErasedAt: '2026-11-10T08:00:00Z' };
    renderDetail(['returns:read', 'returns:write', 'returns:erase_personal_data']);
    expect(await screen.findByText(fill('detail.erased', { date: 'at 2026-11-10' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: R['detail.guest.actions']! })).not.toBeInTheDocument();
  });

  it('shows no guest marking or guest actions on a customer’s case', async () => {
    rc = { ...GUEST, guest: false, customerAccountId: '00000000-0000-4000-8000-000000000002', contactVerifiedAt: null as never, comments: [] };
    renderDetail(['*']);
    expect(await screen.findByText(R['detail.noOrder']!)).toBeInTheDocument();
    expect(screen.queryByText(R['list.guest']!)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: R['detail.guest.actions']! })).not.toBeInTheDocument();
  });
});
