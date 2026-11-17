import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issues #1476 (SALES-11) and #1477 (SALES-20), under the pattern of #1434
 * (DS-17): the quote request list and detail printed the raw status code —
 * `Created from admin`, `Pending` — in English whatever the admin language,
 * and the detail header repeated the request's UUID beside its business ID.
 *
 * Rendered against the shipped catalogues in `en` and `pl`. The Polish run uses
 * Polish as its own fallback (`renderWithI18n`), so a key missing from `pl.json`
 * shows up as a raw key instead of hiding behind English.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    useAuth: () => ({ me: { role: { code: 'platform_admin' } } }),
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
  };
});
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>('@endora-commerce/admin-kit/components');
  return { ...actual, OrganizationPicker: () => null, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqList } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqList');
const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CATALOGUES = {
  en: { core: read('../packages/modules/_i18n/i18n/en.json'), quote_requests: read('../packages/modules/quote_requests/i18n/en.json') },
  pl: { core: read('../packages/modules/_i18n/i18n/pl.json'), quote_requests: read('../packages/modules/quote_requests/i18n/pl.json') },
};

const STATUS_KEYS: Record<string, string> = {
  'Created from admin': 'rfq.status.createdFromAdmin',
  Pending: 'rfq.status.pending',
  Canceled: 'rfq.status.canceled',
  Approved: 'rfq.status.approved',
  Completed: 'rfq.status.completed',
  Expired: 'rfq.status.expired',
};
const RAW = Object.keys(STATUS_KEYS);
const RFQ_ID = '00000000-0000-4000-8000-0000000000f1';

function rfqRow(status: string): Record<string, unknown> {
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0001',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    organizationName: 'Acme',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    customerDisplayName: 'Buyer',
    status,
    awaitingCustomerRevisionAcceptance: false,
    lineCount: 2,
    amount: null,
    currency: 'PLN',
    submittedAt: null,
    expiresAt: null,
    updatedAt: '2026-05-22T12:00:00Z',
    version: 1,
  };
}

function rfqDetail(status: string): Record<string, unknown> {
  return {
    ...rfqRow(status),
    organization: null,
    customer: null,
    createdByAdminUserId: null,
    assignedAdminUserId: null,
    currentRevisionNumber: 1,
    headerNote: null,
    cancellationReason: null,
    customFieldValues: {},
    items: [],
    events: [],
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    convertedOrderId: null,
    taxRate: 0,
    createdAt: '2026-05-22T11:00:00Z',
  };
}

/** Leaf nodes whose whole text is a raw status code. */
function rawStatusesOnScreen(): string[] {
  return [...document.body.querySelectorAll('*')]
    .filter((node) => node.childElementCount === 0)
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => RAW.includes(text));
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
});
afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('quote request status labels (%s)', (language) => {
  const { core } = CATALOGUES[language];

  it('ships a label for every status in the catalogue', () => {
    for (const key of Object.values(STATUS_KEYS)) {
      expect(core[key], `${key} in ${language}.json`).toBeTruthy();
    }
  });

  it.each(RAW)('labels the %s badge in the list', async (status) => {
    getSpy.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/admin/quote-requests/list-views') ||
      path.startsWith('/api/v1/admin/quote-requests/custom-field-filters')
        ? { data: [] }
        : { data: [rfqRow(status)] },
    );
    renderWithI18n(
      <MemoryRouter>
        <RfqList />
      </MemoryRouter>,
      CATALOGUES[language],
      { language },
    );
    const table = await screen.findByRole('table');
    expect(within(table).getByText(core[STATUS_KEYS[status]!]!)).toBeInTheDocument();
    expect(rawStatusesOnScreen().filter((text) => text !== core[STATUS_KEYS[text]!])).toEqual([]);
  });

  it.each(RAW)('labels the %s badge in the detail header, without the UUID', async (status) => {
    getSpy.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/api/v1/admin/quote-requests/') ? { data: rfqDetail(status) } : { data: [] },
      ),
    );
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
      CATALOGUES[language],
      { language },
    );
    const badge = await screen.findByText(core[STATUS_KEYS[status]!]!);
    const header = document.querySelector('header');
    expect(header?.contains(badge)).toBe(true);
    expect(header?.textContent).not.toContain(RFQ_ID);
    expect(rawStatusesOnScreen().filter((text) => text !== core[STATUS_KEYS[text]!])).toEqual([]);
  });
});
