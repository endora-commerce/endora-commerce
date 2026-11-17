import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * `specs/180-off-platform-complaints/` T081 (FR-B34, FR-B35, D-6; design review R-4):
 * off-platform rows are marked in words, the refund cell says it does not apply, and the
 * origin filter has a chip and a saved-view entry, but no place in the URL.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
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

const ENDPOINT = '/api/v1/admin/returns/list-views';
const LIST = '/api/v1/admin/returns?';
const ROW = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  rmaNumber: null,
  reference: '#AAAAAAAA',
  kind: 'complaint',
  orderId: null,
  offPlatform: true,
  productLabel: 'Drill X200',
  lineCount: 2,
  purchaseDate: '2026-10-01',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  customerName: null,
  organizationName: null,
  authorizedBy: null,
};
const VIEW = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Bought elsewhere',
  shared: false,
  ownerAdminUserId: '00000000-0000-4000-8000-0000000000a1',
  ownedByCaller: true,
  canModify: true,
  filters: { origin: 'off_platform' },
  sort: null,
};

const BUNDLE = {
  core: en as Record<string, string>,
  returns: {
    'list.offPlatform': 'Off-platform',
    'list.notApplicable': 'Not applicable',
    'list.filter.origin': 'Origin',
    'list.origin.platform': 'Platform order',
    'list.origin.off_platform': 'Off-platform',
  },
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/returns/statuses')) return { data: { statuses: [], transitions: [] } };
    if (path.startsWith(ENDPOINT)) return { data: [VIEW] };
    if (path.startsWith(LIST)) return { data: { rows: [ROW], total: 1, counts: {} } };
    return { data: [] };
  });
  api.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ data: { ...VIEW, ...body, id: 'v2' } }));
});
afterEach(() => vi.restoreAllMocks());

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

async function renderList() {
  const user = userEvent.setup();
  renderWithI18n(
    <MemoryRouter initialEntries={['/returns']}>
      <ReturnsList />
      <LocationProbe />
    </MemoryRouter>,
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

describe('ReturnsList — cases without a platform order (180 T081)', () => {
  it('marks the row in words and says the refund does not apply', async () => {
    await renderList();
    expect(screen.getAllByText('Off-platform').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not applicable').length).toBeGreaterThan(0);
    expect(screen.queryByText(/0[.,]00/)).not.toBeInTheDocument();
  });

  it('filters by origin with a chip, and keeps the filter out of the URL (D-6)', async () => {
    const user = await renderList();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Origin' }), 'off_platform');
    await waitFor(() => expect(listRequests().some((p) => p.get('origin') === 'off_platform')).toBe(true));
    expect(screen.getByRole('button', { name: /Origin: Off-platform/ })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('');
  });

  it('restores the origin from a saved view, and saves it', async () => {
    const user = await renderList();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), VIEW.id);
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Origin' }) as HTMLSelectElement).value).toBe('off_platform'));
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Again{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((api.post.mock.calls[0]![1] as { filters: Record<string, unknown> }).filters).toEqual({ origin: 'off_platform' });
  });
});
