import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * `specs/173-b2c-address-book-merge/` T-A1 (OD-6, FR-012) — the customer's
 * addresses card lists the book the customer orders from, the Organization's,
 * read-only, and then any personal-book row the release-1 retirement job
 * refused, with its reason. There is no add form: the personal book is retired
 * and admin editing of Organization addresses is a separate follow-up.
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

const { AddressesPanel } = await import(
  '../../../../packages/modules/customers/src/admin/panels/ManagementPanels'
);

function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const read = (path: string) =>
    JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
  return {
    customers: read(`../packages/modules/customers/i18n/${language}.json`),
    core: read(`../packages/modules/_i18n/i18n/${language}.json`),
  };
}

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

const BOOK = {
  organization: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      organizationId: '00000000-0000-4000-8000-0000000000o1',
      kind: 'delivery',
      recipientName: 'Anna Nowak',
      street: 'ul. Długa 5',
      city: 'Gdańsk',
      postalCode: '80-001',
      country: 'PL',
      phone: null,
      isDefault: true,
    },
  ],
  personal: [
    {
      id: '00000000-0000-4000-8000-0000000000p1',
      customerAccountId: CUSTOMER_ID,
      kind: 'billing',
      recipientName: 'Anna Stara',
      street: 'ul. Stara 1',
      city: 'Belgrade',
      postalCode: '11000',
      country: 'YU',
      phone: null,
      isDefault: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      mergeRefusal: 'DICTIONARY_ENTRY_INACTIVE',
    },
  ],
};

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockResolvedValue({ data: BOOK });
});

describe.each([
  { language: 'en', organizationBook: 'Organization address book', refused: 'Not moved from the personal address book' },
  { language: 'pl', organizationBook: 'Książka adresowa organizacji', refused: 'Nieprzeniesione z osobistej książki adresowej' },
] as const)('the customer addresses card ($language, T-A1)', ({ language, organizationBook, refused }) => {
  it('lists the Organization book, then the refused rows with their reason, and has no form', async () => {
    const view = renderWithI18n(<AddressesPanel customerId={CUSTOMER_ID} onChanged={() => undefined} />, bundle(language), {
      language,
    });
    await waitFor(() => expect(screen.getByText(/ul\. Długa 5/)).toBeTruthy());
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/customers/${CUSTOMER_ID}/addresses`);
    expect(screen.getByText(organizationBook)).toBeTruthy();
    expect(screen.getByText(refused)).toBeTruthy();
    expect(screen.getByText(/ul\. Stara 1/)).toBeTruthy();
    expect(screen.getByText(/DICTIONARY_ENTRY_INACTIVE/)).toBeTruthy();
    // Read-only: no input, no select, no button.
    expect(view.container.querySelectorAll('input, select, textarea, button')).toHaveLength(0);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('says the Organization book is empty, and shows no refused section when there is none', async () => {
    getSpy.mockResolvedValue({ data: { organization: [], personal: [] } });
    const view = renderWithI18n(<AddressesPanel customerId={CUSTOMER_ID} onChanged={() => undefined} />, bundle(language), {
      language,
    });
    const empty = bundle(language).customers!['detail.addresses.empty']!;
    await waitFor(() => expect(screen.getByText(empty)).toBeTruthy());
    expect(screen.queryByText(refused)).toBeNull();
    expect(view.container.querySelectorAll('input, select, button')).toHaveLength(0);
  });
});
