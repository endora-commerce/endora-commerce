import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * The quote-request screen still renders its custom fields and still saves
 * them, with the panel resolved from `@endora-commerce/admin-kit/components`
 * (feature 091, P4e).
 *
 * This is the strictest of the four call sites and the one that settles §9.1:
 * the write is `PATCH /api/v1/admin/quote-requests/:id` carrying the request's
 * **`If-Match`** version header. Optimistic concurrency over the quote request
 * is `quote_requests`' concern and no part of it is visible to the panel — data
 * in, edited data back — which is why the reach was a host rendering its own
 * data and never the owner mounting a fragment.
 *
 * The panel is also held back on a terminal request, which is the screen's own
 * rule and survives the move.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock('@/modules/catalog/components/ProductPicker', () => ({ ProductPicker: () => null }));

const { RfqDetail } = await import('../../../src/modules/quote_requests/RfqDetail');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const VERSION = 7;

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d004',
  entityType: 'quote_request',
  key: 'project_code',
  label: { en: 'Project code' },
  labelDefault: 'Project code',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function rfqPayload(status: string): Record<string, unknown> {
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0001',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    organization: null,
    customer: null,
    createdByAdminUserId: null,
    assignedAdminUserId: null,
    status,
    awaitingCustomerRevisionAcceptance: false,
    currentRevisionNumber: 1,
    headerNote: null,
    cancellationReason: null,
    customFieldValues: { project_code: 'PRJ-1' },
    items: [],
    events: [],
    submittedAt: '2026-08-01T10:00:00.000Z',
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    expiresAt: null,
    convertedOrderId: null,
    taxRate: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    version: VERSION,
  };
}

function renderDetail(status = 'Pending'): void {
  getSpy.mockImplementation((url: string) => {
    if (url === '/api/v1/admin/custom-fields/definitions?entityType=quote_request') {
      return Promise.resolve({ data: [DEFINITION] });
    }
    if (typeof url === 'string' && url.startsWith('/api/v1/admin/quote-requests/')) {
      return Promise.resolve({ data: rfqPayload(status) });
    }
    return Promise.resolve({ data: { resolvedPrice: { basePrice: null, salePrice: null } } });
  });
  renderWithI18n(
    <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
      <Routes>
        <Route path="/quote-requests/:id" element={<RfqDetail />} />
      </Routes>
    </MemoryRouter>,
    bundle,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: {} });
});

describe('RfqDetail — custom fields, through the published panel', () => {
  it('renders the panel over the request\'s own stored bag', async () => {
    renderDetail();

    expect(await screen.findByText(CORE_EN['customFields.title'] as string)).toBeTruthy();
    expect(await screen.findByLabelText('Project code')).toHaveValue('PRJ-1');
    expect(getSpy.mock.calls.map((call) => call[0])).toContain(
      '/api/v1/admin/custom-fields/definitions?entityType=quote_request',
    );
  });

  it('saves through the screen\'s own PATCH, carrying the `If-Match` version', async () => {
    renderDetail();

    const input = await screen.findByLabelText('Project code');
    await userEvent.clear(input);
    await userEvent.type(input, 'PRJ-2');
    await userEvent.click(
      screen.getByRole('button', { name: CORE_EN['customFields.save'] as string }),
    );

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(`/api/v1/admin/quote-requests/${RFQ_ID}`);
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({
      customFieldValues: { project_code: 'PRJ-2' },
    });
    expect(patchSpy.mock.calls[0]?.[2]).toEqual({ headers: { 'If-Match': `"${VERSION}"` } });
  });

  it('holds the panel back on a terminal request — the screen\'s own rule', async () => {
    renderDetail('Completed');

    await screen.findByRole('tab', { name: CORE_EN['rfq.detail.tabs.overview'] as string });
    await waitFor(() =>
      expect(getSpy.mock.calls.map((call) => call[0])).toContain(
        `/api/v1/admin/quote-requests/${RFQ_ID}`,
      ),
    );
    expect(screen.queryByText(CORE_EN['customFields.title'] as string)).toBeNull();
  });
});
