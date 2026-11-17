import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { CASE_180 } from './return-detail-fixture';

/**
 * `specs/180-off-platform-complaints/` T030 (FR-A41 – FR-A44; design review R-5.2):
 * the case detail says who authorized the case and when, and titles a case without
 * an RMA number by its reference.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    formatDateTime: () => '2 Nov 2026, 10:00',
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

const BUNDLE = {
  returns: {
    'detail.caseCard': 'Case',
    'detail.authorized': 'Authorized',
    'detail.authorizedBy': '{at} by {name}',
    'detail.authorizedByFormer': '{at} by former administrator',
    'detail.authorizedUnknown': '{at}, authorizer unknown',
    'detail.notAuthorized': 'Not yet',
  },
};

let rc: typeof CASE_180;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  rc = { ...CASE_180 };
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: rc });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    return Promise.resolve({ data: [] });
  });
});

function renderDetail(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/returns/r1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

const AUTHORIZED = { statusCode: 'authorized', statusLabel: 'Authorized', rmaNumber: 'RMA-1042', reference: 'RMA-1042', authorizedAt: '2026-11-02T10:00:00Z' };

describe('ReturnDetail — who authorized the case (180 T030)', () => {
  it('shows the authorizer’s name with the time', async () => {
    rc = { ...CASE_180, ...AUTHORIZED, authorizedBy: { adminUserId: '00000000-0000-4000-8000-0000000000b1', name: 'Ada Admin' } };
    renderDetail();
    expect(await screen.findByText('2 Nov 2026, 10:00 by Ada Admin')).toBeInTheDocument();
  });

  it('says "former administrator" for an id that no longer resolves (FR-A42)', async () => {
    rc = { ...CASE_180, ...AUTHORIZED, authorizedBy: { adminUserId: '00000000-0000-4000-8000-0000000000b1', name: null } };
    renderDetail();
    expect(await screen.findByText('2 Nov 2026, 10:00 by former administrator')).toBeInTheDocument();
  });

  it('says "unknown" when no authorizer was recorded (FR-A43)', async () => {
    rc = { ...CASE_180, ...AUTHORIZED, authorizedBy: { adminUserId: null, name: null } };
    renderDetail();
    expect(await screen.findByText('2 Nov 2026, 10:00, authorizer unknown')).toBeInTheDocument();
  });

  it('says "Not yet" for a case that is not authorized, and titles it by its reference (FR-A44)', async () => {
    renderDetail();
    expect(await screen.findByText('Not yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('#3F9A21C0');
  });
});
