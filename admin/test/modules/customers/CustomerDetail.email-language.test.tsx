import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #652 (D-292) — the admin customer detail shows the customer's e-mail
 * language read-only, beside the other account facts. Staff with
 * `customers:read` see it; nobody edits it here — only the buyer does, on the
 * storefront account page. An unknown language says what is used instead.
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

// The screen's sibling panels each pull their own data chain; none is under
// test here.
//
// **Both spellings are the package's own source, and that is feature 091's
// batch 14 re-keying them rather than tidying them.** They read
// `@/modules/customers/panels/…` until that batch, and the screen now imports
// `../panels/HistoryPanels.js` from inside
// `@endora-commerce/mod-customers`, where the `@/` alias resolves to nothing —
// so the old spelling would have named a file that is gone, and vitest answers
// a mock over a deleted path by making it **inert** rather than by failing.
// Both panels would have mounted for real and reached the stubbed `apiClient`
// with requests this file makes no assertion about. `tsc` is what found it,
// by the dynamic import below.
vi.mock('../../../../packages/modules/customers/src/admin/panels/HistoryPanels', () => ({
  OrdersPanel: () => null,
  QuoteRequestsPanel: () => null,
  CartsPanel: () => null,
}));
vi.mock('../../../../packages/modules/customers/src/admin/panels/ManagementPanels', () => ({
  OrganizationAssignmentPanel: () => null,
  CustomerGroupPanel: () => null,
  AddressesPanel: () => null,
}));
// A fourth `vi.mock` stood here until feature 091's P7b — `quick_order`'s
// `DefaultPreferencesPanel`, which this screen imported by path. It is a
// `customer.detail.after` contribution now and its `admin/src` copy is deleted,
// so the mock named a module that no longer exists — and vitest answered that by
// making it **inert** rather than by failing. What replaces it is the empty
// registry below: the zone enumerates nothing here, because this file's subject
// is the custom-field panel and not the zone.

const { CustomerDetail } = await import(
  '../../../../packages/modules/customers/src/admin/pages/CustomerDetail',
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const CUSTOMERS_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/customers/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN, customers: CUSTOMERS_EN };

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000006c2';

const CUSTOMER = {
  id: CUSTOMER_ID,
  email: 'buyer652@test.com',
  firstName: 'Ewa',
  lastName: 'Language',
  organizationId: null,
  organizationName: null,
  customerGroupId: null,
  customerGroupName: null,
  blocked: false,
  deleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  block: null,
  deletion: null,
  customFieldValues: {},
};

function renderDetail(preferredLanguage: string | null, language: 'en' | 'pl' = 'en'): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/customers/${CUSTOMER_ID}`) {
      return Promise.resolve({ data: { ...CUSTOMER, preferredLanguage } });
    }
    if (path === '/api/v1/admin/custom-fields/definitions?entityType=customer') {
      return Promise.resolve({ data: [] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/customers/${CUSTOMER_ID}`]}>
        <Routes>
          <Route path="/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['customers:read'] }),
        presence: modulePresence({ present: ['customers'] }),
        contributions: [],
      },
    ),
    bundle,
    { language },
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
});

describe('CustomerDetail — the e-mail language row (#652)', () => {
  it('shows the stored language, read-only', async () => {
    renderDetail('pl-PL');

    const term = await screen.findByText(CUSTOMERS_EN['detail.field.emailLanguage'] as string);
    expect(term.tagName).toBe('DT');
    expect(term.nextElementSibling?.querySelector('input, select, button')).toBeNull();
  });

  // Issue #1328 — the row named the language by its raw tag (`en-US`). It names it in the
  // admin's language now, and keeps the tag beside it as secondary text.
  it('names the language in the admin language, with the tag as secondary text', async () => {
    renderDetail('en-US');

    const term = await screen.findByText(CUSTOMERS_EN['detail.field.emailLanguage'] as string);
    const value = term.nextElementSibling as HTMLElement;
    expect(value.querySelector('[data-language-name]')?.textContent).toBe('English (US)');
    expect(value.querySelector('[data-language-tag]')?.textContent).toBe('en-US');
  });

  it('names the language in Polish for a Polish-speaking operator', async () => {
    renderDetail('en-US', 'pl');

    const term = await screen.findByText(CUSTOMERS_EN['detail.field.emailLanguage'] as string);
    const value = term.nextElementSibling as HTMLElement;
    expect(value.querySelector('[data-language-name]')?.textContent).toBe('Angielski (USA)');
    expect(value.querySelector('[data-language-tag]')?.textContent).toBe('en-US');
  });

  it('shows a tag no language name is known for as the tag alone', async () => {
    renderDetail('xx-YY');

    const term = await screen.findByText(CUSTOMERS_EN['detail.field.emailLanguage'] as string);
    expect(term.nextElementSibling?.textContent).toBe('xx-YY');
  });

  it('says the store default is used when none is known', async () => {
    renderDetail(null);

    const term = await screen.findByText(CUSTOMERS_EN['detail.field.emailLanguage'] as string);
    expect(term.nextElementSibling?.textContent).toBe(CUSTOMERS_EN['detail.field.emailLanguageUnset']);
  });
});
