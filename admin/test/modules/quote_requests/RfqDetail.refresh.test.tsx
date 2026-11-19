import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1496 (UX audit SALES-06, on DS-14 #1447) — the quote-request screen
 * re-reads after Approve with the request still on screen and its tab open,
 * marked `aria-busy`, instead of replacing the page with "Loading…"; the first
 * load is a skeleton; a first load that fails is an error with a retry.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const VERSION = 7;

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
    customFieldValues: {},
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

function renderDetail(readRfq: () => Promise<unknown>): void {
  getSpy.mockImplementation((url: string) => {
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}`) return readRfq();
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
        <Routes>
          <Route path="/quote-requests/:id" element={<RfqDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['rfqs:handle'] }),
        presence: modulePresence({ present: ['quote_requests'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

const approveName = (): string => CORE_EN['rfq.detail.approve']!;

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('RfqDetail — first load and refresh (SALES-06)', () => {
  it('shows a busy skeleton region on the first load', async () => {
    let release!: () => void;
    renderDetail(() => new Promise((resolve) => (release = () => resolve({ data: rfqPayload('Pending') }))));

    const region = await screen.findByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent(CORE_EN['rfq.detail.loading']!);

    release();
    expect(await screen.findByRole('button', { name: approveName() })).toBeInTheDocument();
  });

  it('keeps the request on screen and busy while it re-reads after Approve', async () => {
    const reads: Array<(value: unknown) => void> = [];
    renderDetail(() => new Promise((resolve) => reads.push(resolve)));
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!({ data: rfqPayload('Pending') });
    const tablist = await screen.findByRole('tablist');
    postSpy.mockResolvedValue({});

    await userEvent.click(await screen.findByRole('button', { name: approveName() }));
    // Approve asks first since #1497 (SALES-12).
    await answerConfirm(true);

    await waitFor(() => expect(reads).toHaveLength(2));
    expect(tablist).toBeInTheDocument();
    expect(tablist.closest('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="detail-skeleton"]')).toBeNull();

    reads[1]!({ data: rfqPayload('Approved') });
    await waitFor(() => expect(tablist.closest('[aria-busy="true"]')).toBeNull());
    expect(tablist).toBeInTheDocument();
  });

  it('a first load that fails is an error with a retry, not "not found"', async () => {
    let attempt = 0;
    renderDetail(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: rfqPayload('Pending') });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CORE_EN['rfq.detail.error.load']!);
    expect(alert).not.toHaveTextContent(CORE_EN['rfq.detail.notFound']!);

    await userEvent.click(within(alert).getByRole('button', { name: CORE_EN['common.action.retry']! }));
    expect(await screen.findByRole('button', { name: approveName() })).toBeInTheDocument();
  });
});
