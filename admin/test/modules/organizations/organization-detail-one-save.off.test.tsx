import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';

/**
 * Feature 180, WP-7 — the organization detail's one Save with a participant's module off
 * (US5; FR-034; Principle XVII).
 *
 * A module that is off takes no part: no panel, no request of its own, nothing counted, and the
 * screen's Save writes the host part alone. A participant's write refused with
 * `503 MODULE_DISABLED` (switched off between the read and the Save) is that part not saved,
 * named as switched off, while the host part stays saved.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));
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
const priceLists = await import('@endora-commerce/mod-price-lists/admin');
const quickOrder = await import('@endora-commerce/mod-quick-order/admin');
const quoteRequests = await import('@endora-commerce/mod-quote-requests/admin');
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const coreEn = read('../packages/modules/_i18n/i18n/en.json');
const orgEn = read('../packages/modules/organizations/i18n/en.json');
const EMAILS_LABEL = orgEn['detail.orderConfirmationEmails']!;
const bundle = {
  core: coreEn,
  organizations: orgEn,
  price_lists: read('../packages/modules/price_lists/i18n/en.json'),
  quick_order: read('../packages/modules/quick_order/i18n/en.json'),
  quote_requests: read('../packages/modules/quote_requests/i18n/en.json'),
};

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const UPDATED_AT = '2026-05-01T09:00:00.000Z';
const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;
const MODE_URL = `/api/v1/admin/pricing/display-mode-overrides/organization/${ORG_ID}`;
const PREFERENCES_URL = '/api/v1/admin/quick-order/preferences';
const NEGOTIATION_URL = `${ORG_URL}/quote-price-negotiation`;

/** The request prefixes each participant module owns on this screen. */
const OWNED: Record<string, readonly string[]> = {
  price_lists: ['/api/v1/admin/pricing/'],
  quick_order: [PREFERENCES_URL, `${ORG_URL}/addresses`],
  quote_requests: [NEGOTIATION_URL],
};

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
  version: 3,
  updatedAt: UPDATED_AT,
};

function renderDetail(absent: readonly string[]): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
      <Routes>
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: everyDeclaredModule().filter((id) => !absent.includes(id)), absent: [...absent] }),
      contributions: [
        { moduleId: 'price_lists', contributions: priceLists.contributions },
        { moduleId: 'quick_order', contributions: quickOrder.contributions },
        { moduleId: 'quote_requests', contributions: quoteRequests.contributions },
      ],
      bundle,
    },
  );
}

const saveButton = (): HTMLElement => screen.getByRole('button', { name: /^Save( \d+ changes?)?$|^Saving…$/ });
const requested = (): string[] => [...api.get.mock.calls, ...api.put.mock.calls].map(([url]) => String(url));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === ORG_URL) return { data: { ...ORG } };
    if (url === `${ORG_URL}/restrictions`) {
      return { data: { organizationId: ORG_ID, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [], version: 3 } };
    }
    if (url.startsWith('/api/v1/admin/warehouses')) return { items: [] };
    if (url === MODE_URL) return { data: { mode: 'gross_only' } };
    if (url.startsWith(`${PREFERENCES_URL}?`)) return { data: null };
    if (url === NEGOTIATION_URL) return { data: { organizationId: ORG_ID, priceProposalsAllowed: false, updatedAt: null } };
    const channels = organizationSalesChannelsAnswer(url);
    if (channels) return channels;
    return { data: [], items: [] };
  });
  api.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({
    data: { ...ORG, ...body, version: 4, updatedAt: '2026-05-01T10:00:00.000Z' },
  }));
  api.put.mockResolvedValue({ data: {} });
});
afterEach(() => cleanup());

describe('organization detail one Save with a participant module off (FR-034)', () => {
  for (const moduleId of ['price_lists', 'quick_order', 'quote_requests'] as const) {
    it(`${moduleId} off: no panel, no request of its own, and Save writes the host part alone`, async () => {
      renderDetail([moduleId]);
      const emails = await screen.findByLabelText(EMAILS_LABEL);
      // The other participants render, so the zone itself is mounted.
      if (moduleId !== 'price_lists') await screen.findByLabelText(coreEn['priceLists.displayMode.rowLabel']!);
      else await screen.findByLabelText(coreEn['defaultPreferences.paymentMethod']!);
      await new Promise((settle) => setTimeout(settle, 50));

      expect(requested().filter((url) => OWNED[moduleId]!.some((prefix) => url.startsWith(prefix)))).toEqual([]);
      expect(saveButton()).toHaveAccessibleName('Save');

      fireEvent.change(emails, { target: { value: 'ops@example.com' } });
      expect(saveButton()).toHaveAccessibleName('Save 1 change');
      fireEvent.click(saveButton());
      await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
      // Issue #1468 — the host part never carries the status or the VAT status.
      const body = api.patch.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('vatStatus');
      expect(body).toMatchObject({ orderConfirmationEmails: ['ops@example.com'] });
      await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save'));
      expect(api.put).not.toHaveBeenCalled();
    });
  }

  it('names a 503 MODULE_DISABLED as the part being switched off, the host part saved', async () => {
    api.put.mockImplementation(async (url: string) => {
      if (url === MODE_URL) {
        throw new ApiError(503, { error: { code: 'MODULE_DISABLED', message: 'Module price_lists is disabled.', requestId: 'r' } } as never);
      }
      return { data: {} };
    });
    renderDetail([]);
    const emails = await screen.findByLabelText(EMAILS_LABEL);
    const mode = (await screen.findByLabelText(coreEn['priceLists.displayMode.rowLabel']!)) as HTMLSelectElement;
    await waitFor(() => expect(mode.disabled).toBe(false));
    fireEvent.change(emails, { target: { value: 'ops@example.com' } });
    fireEvent.change(mode, { target: { value: 'both' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(coreEn['saveSession.summary.partial']!)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(new RegExp(coreEn['saveSession.error.moduleOff']!.replace('.', '\\.'))).length).toBeGreaterThan(0);
  });
});
