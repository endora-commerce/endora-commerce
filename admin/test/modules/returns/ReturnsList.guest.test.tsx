import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/_i18n/i18n/en.json';
import returnsEn from '../../../../packages/modules/returns/i18n/en.json';

/**
 * `specs/181-guest-complaints/` T048 (US3; FR-061; contracts/admin-api.md A6; research
 * R-10): a guest's row is marked in words, its customer cell names the guest (or says the
 * data is erased), and the origin filter offers the five choices.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnsList } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnsList');

const LIST = '/api/v1/admin/returns?';
const ROW = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  rmaNumber: null,
  reference: '#AAAAAAAA',
  kind: 'complaint',
  orderId: null,
  offPlatform: true,
  guest: true,
  productLabel: 'Drill X200',
  lineCount: 1,
  purchaseDate: '2026-10-01',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  customerAccountId: null,
  customerName: 'Gość Kowalski',
  organizationName: null,
  authorizedBy: null,
};
const ERASED = { ...ROW, id: 'bbbbbbbb-0000-4000-8000-000000000002', reference: '#BBBBBBBB', customerName: null };
const CUSTOMER = { ...ROW, id: 'cccccccc-0000-4000-8000-000000000003', reference: '#CCCCCCCC', guest: false, customerAccountId: '00000000-0000-4000-8000-000000000002', customerName: null };

const BUNDLE = { core: en as Record<string, string>, returns: returnsEn as Record<string, string> };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/returns/statuses')) return { data: { statuses: [], transitions: [] } };
    if (path.startsWith('/api/v1/admin/returns/list-views')) return { data: [] };
    if (path.startsWith(LIST)) return { data: { rows: [ROW, ERASED, CUSTOMER], total: 3, counts: {} } };
    return { data: [] };
  });
});
afterEach(() => vi.restoreAllMocks());

async function renderList() {
  const user = userEvent.setup();
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/returns']}>
        <ReturnsList />
      </MemoryRouter>,
      // The kit pager reads the admin's remembered page size, inside the session (issue #1500).
      { session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
  );
  await screen.findAllByRole('link', { name: '#AAAAAAAA' });
  return user;
}

const listRequests = () =>
  api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.slice(path.indexOf('?') + 1)));

describe('ReturnsList — guest cases (181 T048)', () => {
  it('marks a guest row with a Guest badge and names the guest in the customer column', async () => {
    await renderList();
    const row = screen.getAllByRole('link', { name: '#AAAAAAAA' })[0]!.closest('tr')!;
    expect(within(row).getByText(returnsEn['list.guest'])).toBeInTheDocument();
    expect(within(row).getByText(returnsEn['list.customer.guest'].replace('{name}', 'Gość Kowalski'))).toBeInTheDocument();
  });

  it('says the data was erased for a guest row without a name', async () => {
    await renderList();
    const row = screen.getAllByRole('link', { name: '#BBBBBBBB' })[0]!.closest('tr')!;
    expect(within(row).getByText(returnsEn['list.customer.guestErased'])).toBeInTheDocument();
  });

  it('does not mark a customer’s row as a guest’s', async () => {
    await renderList();
    const row = screen.getAllByRole('link', { name: '#CCCCCCCC' })[0]!.closest('tr')!;
    expect(within(row).queryByText(returnsEn['list.guest'])).not.toBeInTheDocument();
  });

  it('offers every origin and asks the list for the guest one', async () => {
    const user = await renderList();
    const select = screen.getByRole('combobox', { name: returnsEn['list.filter.origin'] }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'platform', 'off_platform', 'off_platform_customer', 'guest']);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      returnsEn['list.filter.origin'],
      returnsEn['list.origin.platform'],
      returnsEn['list.origin.off_platform'],
      returnsEn['list.origin.off_platform_customer'],
      returnsEn['list.origin.guest'],
    ]);
    await user.selectOptions(select, 'guest');
    await waitFor(() => expect(listRequests().some((p) => p.get('origin') === 'guest')).toBe(true));
    expect(screen.getByRole('button', { name: new RegExp(`${returnsEn['list.filter.origin']}: ${returnsEn['list.origin.guest']}`) })).toBeInTheDocument();
  });
});
