import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * `specs/180-off-platform-complaints/` T031 (FR-A41, FR-A42, FR-A44; D-4; design
 * review R-4.4, R-4.5): the list's *Authorized by* column, not sortable, and the
 * case reference as every row's link text.
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

const row = (id: string, over: Record<string, unknown>) => ({
  id,
  rmaNumber: null,
  reference: `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
  kind: 'complaint',
  orderId: '00000000-0000-4000-8000-000000000001',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  customerName: null,
  organizationName: null,
  authorizedBy: null,
  ...over,
});

const ROWS = [
  row('aaaaaaaa-0000-4000-8000-000000000001', {}),
  row('bbbbbbbb-0000-4000-8000-000000000002', {
    rmaNumber: 'RMA-1042',
    reference: 'RMA-1042',
    authorizedBy: { adminUserId: '00000000-0000-4000-8000-0000000000b1', name: 'Ada Admin' },
  }),
  row('cccccccc-0000-4000-8000-000000000003', {
    rmaNumber: 'RMA-1043',
    reference: 'RMA-1043',
    authorizedBy: { adminUserId: '00000000-0000-4000-8000-0000000000b2', name: null },
  }),
  row('dddddddd-0000-4000-8000-000000000004', {
    rmaNumber: 'RMA-1044',
    reference: 'RMA-1044',
    authorizedBy: { adminUserId: null, name: null },
  }),
];

const BUNDLE = {
  returns: {
    'list.col.authorizedBy': 'Authorized by',
    'list.authorizedBy.former': 'Former administrator',
    'list.authorizedBy.unknown': 'Unknown',
    'list.authorizedBy.unknownHint': 'Authorized before this was recorded',
  },
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/returns?')) return Promise.resolve({ data: { rows: ROWS, total: ROWS.length, counts: {} } });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    return Promise.resolve({ data: [] });
  });
});

function renderList(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <ReturnsList />
      </MemoryRouter>,
      // The kit pager reads the admin's remembered page size, inside the session (issue #1500).
      { session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
  );
}

describe('ReturnsList — Authorized by and the reference (180 T031)', () => {
  it('offers an Authorized by column the sort does not', async () => {
    renderList();
    expect((await screen.findAllByText('Authorized by')).length).toBeGreaterThan(0);
    const sort = document.getElementById('rsort')!;
    expect(within(sort).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual([
      'submittedAt:desc',
      'submittedAt:asc',
      'rmaNumber:asc',
      'rmaNumber:desc',
    ]);
  });

  it('names the authorizer, a former administrator, or an unknown one', async () => {
    renderList();
    expect((await screen.findAllByText('Ada Admin')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Former administrator').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
  });

  it('uses the reference as the row’s link text, never a dash (D-4)', async () => {
    renderList();
    expect((await screen.findAllByRole('link', { name: '#AAAAAAAA' })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'RMA-1042' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: '—' })).not.toBeInTheDocument();
  });
});
