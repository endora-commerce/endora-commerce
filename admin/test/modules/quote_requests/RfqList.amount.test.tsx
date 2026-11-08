import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
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

/** The shipped core bundle of one language. */
const shipped = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;

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
    row(1, { amount: '33.50', agreement: 'agreed' }),
    // One line agreed at 10.00 × 2, one asked at 5.00 × 3.
    row(2, { amount: '35.00', agreement: 'partial' }),
    // Both lines asked only: 12.00 × 2 + 5.00 × 3.
    row(3, { amount: '39.00', agreement: 'none' }),
    // No price on any line.
    row(4, { amount: null, agreement: 'none' }),
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
 * Issue #456 (owner ruling of 2026-11-07, PO ruling of 2026-11-08) — the quote
 * desk list shows the one amount `quote_requests` publishes (per line, agreed
 * price or else the asked one) and says how far it is agreed: no marker,
 * *Partially agreed*, *Not yet agreed* — and `—` with no marker when there is
 * no price at all.
 */
describe.each(['en', 'pl'] as const)('RfqList — the amount and its agreement marker (%s)', (language) => {
  const bundle = shipped(language);
  const partial = bundle['rfq.list.badge.partiallyAgreed']!;
  const notYet = bundle['rfq.list.badge.notYetAgreed']!;

  it('ships both markers', () => {
    expect({ partial, notYet }).toEqual(
      language === 'en'
        ? { partial: 'Partially agreed', notYet: 'Not yet agreed' }
        : { partial: 'Częściowo uzgodnione', notYet: 'Jeszcze nieuzgodnione' },
    );
  });

  it('shows the four states', async () => {
    renderWithI18n(
      <MemoryRouter>
        <RfqList />
      </MemoryRouter>,
      { core: bundle },
      { language },
    );
    const rowOf = (n: number) => screen.getByText(`#QR-${n}`).closest('tr')!;
    await screen.findByText('#QR-1');
    // The Total column: RFQ, Organization, Customer, Status, Lines, Total.
    const total = (n: number) => within(rowOf(n)).getAllByRole('cell')[5]!;

    expect(total(1)).toHaveTextContent(/^33,50\sPLN$/);
    expect(within(rowOf(1)).queryByText(partial)).toBeNull();
    expect(within(rowOf(1)).queryByText(notYet)).toBeNull();

    expect(total(2)).toHaveTextContent(/^35,00\sPLN/);
    expect(within(rowOf(2)).getByText(partial)).toBeInTheDocument();

    expect(total(3)).toHaveTextContent(/^39,00\sPLN/);
    expect(within(rowOf(3)).getByText(notYet)).toBeInTheDocument();

    expect(total(4)).toHaveTextContent(/^—$/);
    expect(within(rowOf(4)).queryByText(partial)).toBeNull();
    expect(within(rowOf(4)).queryByText(notYet)).toBeNull();
  });
});
