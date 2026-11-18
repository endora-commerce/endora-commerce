import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';
import { setMobileViewport } from '../../setup';

/**
 * Issues #1321 and #1322 — the organization detail screen rendered the
 * order-confirmation e-mail field's label and hint as raw catalogue keys, and
 * listed the account and VAT status codes (`active`, `vat_payer`, …) as option
 * text. Since issue #1468 the two selects are gone: the VAT status is header text
 * and the "Change VAT status…" dialog's options. Both languages are rendered against the shipped catalogues, with the
 * Polish one as its own fallback, so a key Polish lacks shows up as a raw key
 * here rather than as English.
 */

const getSpy = vi.fn();

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
  };
});

// Data-heavy siblings with no select of a status code; each has tests of its own.
vi.mock('../../../../packages/modules/organizations/src/admin/panels/VatValidationPanel', () => ({
  VatValidationPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ApplicablePriceListsPanel', () => ({
  ApplicablePriceListsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationSalesRepsTab', () => ({
  OrganizationSalesRepsTab: () => null,
}));

const { OrganizationDetail } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail'
);

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;

const CATALOGUES: Record<'en' | 'pl', { core: Record<string, string>; organizations: Record<string, string> }> = {
  en: {
    core: read('../packages/modules/_i18n/i18n/en.json'),
    organizations: read('../packages/modules/organizations/i18n/en.json'),
  },
  pl: {
    core: read('../packages/modules/_i18n/i18n/pl.json'),
    organizations: read('../packages/modules/organizations/i18n/pl.json'),
  },
};

const STATUSES = ['pending_verification', 'active', 'blocked', 'rejected'];
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'];

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;

const ORG = {
  id: ORG_ID,
  name: 'Acme',
  legalName: null,
  taxId: '1234567890',
  status: 'active',
  vatStatus: 'vat_payer',
  isPersonal: false,
  registeredAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  orderConfirmationEmails: [],
  fulfilmentStrategy: null,
  fulfilmentStrategyWarehouseOrder: null,
  customFieldValues: {},
  parentId: null,
  members: [],
  version: 1,
  updatedAt: '2026-05-01T09:00:00.000Z',
};

function serve(): void {
  getSpy.mockImplementation(async (url: string) => {
    if (url === ORG_URL) return { data: { ...ORG } };
    if (url === `${ORG_URL}/restrictions`) {
      return { data: { organizationId: ORG_ID, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [], version: 1 } };
    }
    const channels = organizationSalesChannelsAnswer(url);
    if (channels) return channels;
    return { data: [], items: [] };
  });
}

function renderDetail(language: SupportedAdminLanguage): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['organizations'] }),
        contributions: [],
      },
    ),
    CATALOGUES[language as 'en' | 'pl'],
    { language },
  );
}

function optionTexts(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  serve();
});
afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('organization detail labels (%s) — issues #1321, #1322', (language) => {
  const own = CATALOGUES[language].organizations;
  const core = CATALOGUES[language].core;

  it('labels the order-confirmation e-mail field and its hint from the catalogue', async () => {
    renderDetail(language);
    const label = own['detail.orderConfirmationEmails'];
    const hint = own['detail.orderConfirmationEmailsHint'];
    expect(label).toBeTruthy();
    expect(hint).toBeTruthy();
    expect(await screen.findByText(label!)).toBeInTheDocument();
    expect(screen.getByText(hint!)).toBeInTheDocument();
  });

  it('names the e-mails textarea by its visible label, not a developer aria-label (#1468)', async () => {
    renderDetail(language);
    const label = own['detail.orderConfirmationEmails']!;
    const field = await screen.findByLabelText(label);
    expect(field).toHaveAccessibleName(label);
    expect(field).not.toHaveAttribute('aria-label');
  });

  it('titles the card "Contact & notifications" (#1468)', async () => {
    renderDetail(language);
    expect(core['organizations.detail.notificationsCard']).toBe(
      language === 'en' ? 'Contact & notifications' : 'Kontakt i powiadomienia',
    );
    expect(await screen.findByText(core['organizations.detail.notificationsCard']!)).toBeInTheDocument();
  });

  it('shows the VAT status in the header by its translated label', async () => {
    renderDetail(language);
    const label = own['vatStatus.vat_payer']!;
    expect(label).toBeTruthy();
    const badge = await screen.findByText(label);
    expect(badge.parentElement?.textContent).toContain(`${core['organizations.detail.vatStatus']!}:`);
  });

  it('lists the VAT status options of the change dialog by their translated labels', async () => {
    renderDetail(language);
    fireEvent.click(await screen.findByRole('button', { name: own['changeVatStatus.button']! }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText(own['changeVatStatus.field.vatStatus']!);
    const expected = VAT_STATUSES.map((v) => own[`vatStatus.${v}`]);
    expect(expected.every(Boolean)).toBe(true);
    expect(optionTexts(select)).toEqual(expected);
  });

  it('shows no raw catalogue key and no raw status code as an option anywhere on the screen', async () => {
    renderDetail(language);
    await screen.findByLabelText(own['detail.orderConfirmationEmails']!);
    expect(document.body.textContent ?? '').not.toMatch(/\b(core|organizations)\.[A-Za-z_]+\.[A-Za-z_.]+/);
    const codes = new Set([...STATUSES, ...VAT_STATUSES]);
    const rawOptions = screen
      .queryAllByRole('option')
      .map((o) => (o.textContent ?? '').trim())
      .filter((text) => codes.has(text));
    expect(rawOptions).toEqual([]);
  });
});
