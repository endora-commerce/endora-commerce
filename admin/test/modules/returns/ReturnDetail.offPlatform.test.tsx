import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { CASE_180 } from './return-detail-fixture';

/**
 * `specs/180-off-platform-complaints/` T082 (FR-B17, FR-B23, FR-B31, FR-B43, D-8; design
 * review R-5): the detail of a case without a platform order.
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

const OFF = {
  ...CASE_180,
  orderId: null,
  offPlatform: true,
  purchase: { proofNumber: 'FV/1/2026', date: '2026-10-01' },
  contact: { name: 'Ewa Nowak', email: 'ewa@example.test', phone: '+48 600 000 000' },
  returnAddress: { name: 'Ewa Nowak', street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
  attachments: [
    { id: 'a1', returnCaseId: 'r1', returnCaseItemId: null, type: 'proof_of_purchase', filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 1000, createdAt: '2026-11-01T10:00:00Z' },
    { id: 'a2', returnCaseId: 'r1', returnCaseItemId: null, type: 'photo', filename: 'defect.png', mimeType: 'image/png', sizeBytes: 2000, createdAt: '2026-11-01T10:00:00Z' },
  ] as Array<Record<string, unknown>>,
  acceptedClauses: [
    { clauseId: 'c1', revision: 2, mode: 'must_accept', language: 'pl', label: 'Warunki', text: 'Treść', linkUrl: 'https://shop.example/terms' },
    { clauseId: 'c2', revision: 1, mode: 'inform_only', language: 'pl', label: 'Informacja', text: 'Tekst', linkUrl: null },
  ],
  clausesAcceptedAt: '2026-11-01T10:00:00Z',
  personalDataErasedAt: null as string | null,
};

const BUNDLE = {
  returns: {
    'detail.noOrder': 'No order in this shop',
    'detail.purchaseCard': 'Purchase and contact',
    'detail.purchaseDate': 'Purchase date',
    'detail.purchaseNumber': 'Receipt or invoice number',
    'detail.contact': 'Contact',
    'detail.returnAddress': 'Return address',
    'detail.erased': 'The customer’s personal data was erased on {date}.',
    'attachments.title': 'Attachments',
    'attachments.type.proof_of_purchase': 'Proof of purchase',
    'attachments.type.photo': 'Photos',
    'attachments.type.other': 'Other',
    'attachments.open': 'Open {filename}',
    'attachments.none': 'The customer attached no files.',
    'attachments.erased': 'Attachments were deleted with the customer’s personal data on {date}.',
    'attachments.ofLine': 'Files of {product}',
    'attachments.allOnLines': 'Every file belongs to a product line; see Returned items.',
    'attachments.kind.photo': 'Photo',
    'attachments.kind.proof_of_purchase': 'Proof of purchase',
    'attachments.kind.other': 'Document',
    'clauses.acceptedTitle': 'Accepted clauses',
    'clauses.acceptedAt': 'Accepted {at}, in {language}',
    'clauses.revisionOf': '{label} · revision {revision}',
    'clauses.mode.must_accept': 'Must accept',
    'clauses.mode.inform_only': 'Inform only',
    'clauses.fullTerms': 'Full terms',
  },
};

let rc: typeof OFF;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  rc = { ...OFF };
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

describe('ReturnDetail — a case without a platform order (180 T082)', () => {
  it('shows the purchase, the contact and the return address, and no order link', async () => {
    renderDetail();
    expect(await screen.findByText('No order in this shop')).toBeInTheDocument();
    expect(screen.queryByText(/^Order /)).not.toBeInTheDocument();
    expect(screen.getByText('FV/1/2026')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ewa@example.test' })).toHaveAttribute('href', 'mailto:ewa@example.test');
    expect(screen.getByText(/Prosta 1/)).toBeInTheDocument();
  });

  it('lists the attachments by type with links to open them', async () => {
    renderDetail();
    expect(await screen.findByText('Attachments')).toBeInTheDocument();
    expect(screen.getByText('Proof of purchase (1)')).toBeInTheDocument();
    expect(screen.getByText('Photos (1)')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open receipt.pdf' });
    expect(link).toHaveAttribute('href', 'https://api.example/api/v1/admin/returns/r1/attachments/a1/file');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows a line’s photos with that line, and keeps only the case-level files in the attachments card', async () => {
    const line = (id: string, productName: string) => ({
      id,
      orderItemId: null,
      productId: null,
      productName,
      quantity: 1,
      reasonId: null,
      description: null,
      inspectionOutcome: null,
      defaultRefundAmount: 0,
      approvedRefundAmount: 0,
      serialNumber: null,
    });
    rc = {
      ...OFF,
      items: [line('i1', 'Drill X200'), line('i2', 'Saw S10')] as never,
      attachments: [
        ...OFF.attachments,
        { id: 'a3', returnCaseId: 'r1', returnCaseItemId: 'i2', type: 'photo', filename: 'blade.jpg', mimeType: 'image/jpeg', sizeBytes: 3000, createdAt: '2026-11-01T10:00:00Z' },
      ],
    };
    renderDetail();
    const files = await screen.findByRole('list', { name: 'Files of Saw S10' });
    const link = within(files).getByRole('link', { name: 'Open blade.jpg' });
    expect(link).toHaveAttribute('href', 'https://api.example/api/v1/admin/returns/r1/attachments/a3/file');
    expect(link).toHaveAttribute('target', '_blank');
    expect(within(files).getByText('Photo')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Files of Drill X200' })).not.toBeInTheDocument();
    // The case-level card keeps its two files and no longer lists the line's.
    expect(screen.getByText('Photos (1)')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open blade.jpg' })).toHaveLength(1);
  });

  it('says every file belongs to a line when the case has no case-level file', async () => {
    rc = {
      ...OFF,
      items: [{ id: 'i1', orderItemId: null, productId: null, productName: 'Drill X200', quantity: 1, reasonId: null, description: null, inspectionOutcome: null, defaultRefundAmount: 0, approvedRefundAmount: 0, serialNumber: null }] as never,
      attachments: [
        { id: 'a3', returnCaseId: 'r1', returnCaseItemId: 'i1', type: 'photo', filename: 'blade.jpg', mimeType: 'image/jpeg', sizeBytes: 3000, createdAt: '2026-11-01T10:00:00Z' },
      ],
    };
    renderDetail();
    expect(await screen.findByText('Every file belongs to a product line; see Returned items.')).toBeInTheDocument();
    expect(screen.queryByText('The customer attached no files.')).not.toBeInTheDocument();
  });

  it('shows the shown clauses with their mode and link', async () => {
    renderDetail();
    expect(await screen.findByText('Warunki · revision 2')).toBeInTheDocument();
    expect(screen.getByText('Informacja · revision 1')).toBeInTheDocument();
    expect(screen.getAllByText('Must accept').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Full terms' })).toHaveAttribute('href', 'https://shop.example/terms');
  });

  it('says when the personal data was erased, in the contact and the attachments cards (D-8)', async () => {
    rc = { ...OFF, contact: null as never, returnAddress: null as never, attachments: [], personalDataErasedAt: '2026-11-10T08:00:00Z' };
    renderDetail();
    expect(await screen.findByText('The customer’s personal data was erased on at 2026-11-10.')).toBeInTheDocument();
    expect(screen.getByText('Attachments were deleted with the customer’s personal data on at 2026-11-10.')).toBeInTheDocument();
    expect(screen.queryByText('The customer attached no files.')).not.toBeInTheDocument();
  });
});
