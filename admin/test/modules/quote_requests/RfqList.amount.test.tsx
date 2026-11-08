import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';

const getSpy = vi.fn();

/**
 * The **kit's** barrel, not the four `@/lib/*` and `@/components/*` paths this
 * file used to name. The screen is
 * `@endora-commerce/mod-quote-requests/admin`'s since feature 091's batch 12
 * and resolves `apiClient`, `useAuth` and `usePageSizePreference` there; the
 * admin's own paths are re-export shims of the same bindings, so mocking a shim
 * would leave the module the screen actually imports untouched — and `useAuth`
 * would throw `useAuth must be used inside <AuthProvider>`, which is what it
 * did.
 *
 * `useAuth` and `usePageSizePreference` are stubbed for the reason they always
 * were: this is a layout-only test with no `AuthProvider` mounted, which is the
 * pattern `OrdersList.mobile` and `AppShell.mobile` follow.
 */
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
      patch: vi.fn(),
      delete: vi.fn(),
    },
    useAuth: () => ({ me: { role: { code: 'platform_admin' } } }),
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
  };
});

// `OrganizationPicker` pulls the same chain and is the kit's since P2, so the
// stub names the kit's `components` barrel for the same reason.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, OrganizationPicker: () => null };
});

const { RfqList } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqList');

const BUNDLE = passthroughBundle('core', [
  'rfq.list.title',
  'rfq.list.description',
  'rfq.list.field.visibility',
  'rfq.list.scope.mine',
  'rfq.list.scope.unassigned',
  'rfq.list.scope.all',
  'rfq.list.field.status',
  'rfq.list.field.organizationId',
  'rfq.list.field.uuid',
  'rfq.list.refresh',
  'rfq.list.column.rfq',
  'rfq.list.column.organization',
  'rfq.list.column.customer',
  'rfq.list.column.status',
  'rfq.list.column.lines',
  'rfq.list.column.total',
  'rfq.list.statusFilter.all',
  'rfq.list.open',
  'rfq.list.badge.partiallyAgreed',
]);

const row = (n: number, overrides: Record<string, unknown>) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  businessId: `QR-${n}`,
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  organizationName: 'Acme',
  customerAccountId: '00000000-0000-4000-8000-0000000000c1',
  customerDisplayName: 'Buyer',
  status: 'Pending',
  awaitingCustomerRevisionAcceptance: false,
  lineCount: 2,
  currency: 'PLN',
  updatedAt: '2026-05-22T12:00:00Z',
  ...overrides,
});

const RFQ_LIST = {
  data: [
    // One line agreed at 10.00 × 2, one asked at 5.00 × 3 (asked total 39.00).
    row(1, { totalAtCustomerPrice: 39, totalAtAgreedPrice: null, amount: '35.00', partiallyAgreed: true }),
    row(2, { totalAtCustomerPrice: 39, totalAtAgreedPrice: 33.5, amount: '33.50', partiallyAgreed: false }),
  ],
};

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation(async (path: string) =>
    path.startsWith('/api/v1/admin/quote-requests/list-views') ||
    path.startsWith('/api/v1/admin/quote-requests/custom-field-filters')
      ? { data: [] }
      : RFQ_LIST,
  );
});

/**
 * Issue #456 (owner ruling of 2026-11-07) — the quote desk list shows the one
 * amount `quote_requests` publishes (per line, agreed price or else the asked
 * one), and marks a quote whose lines are not all agreed.
 */
describe('RfqList — the amount and the partially-agreed marker', () => {
  it('shows the published amount, with the marker only on a quote not every line of which is agreed', async () => {
    renderWithI18n(
      <MemoryRouter>
        <RfqList />
      </MemoryRouter>,
      BUNDLE,
    );
    const partial = (await screen.findByText('#QR-1')).closest('tr')!;
    const agreed = screen.getByText('#QR-2').closest('tr')!;
    expect(within(partial).getByText(/35,00\sPLN/)).toBeInTheDocument();
    expect(within(partial).queryByText(/39,00/)).toBeNull();
    expect(within(partial).getByText('rfq.list.badge.partiallyAgreed')).toBeInTheDocument();
    expect(within(agreed).getByText(/33,50\sPLN/)).toBeInTheDocument();
    expect(within(agreed).queryByText('rfq.list.badge.partiallyAgreed')).toBeNull();
  });

  it('ships the marker in English and Polish', () => {
    const bundle = (language: string) =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
      ) as Record<string, string>;
    expect(bundle('en')['rfq.list.badge.partiallyAgreed']).toBe('Partially agreed');
    expect(bundle('pl')['rfq.list.badge.partiallyAgreed']).toBe('Częściowo uzgodnione');
  });
});
