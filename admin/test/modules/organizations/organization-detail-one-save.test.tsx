import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';
import { answerConfirm } from '../../helpers/confirm-dialog';

/**
 * Feature 180, WP-7 — the organization detail gets one Save
 * (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2; US9, OQ-9 = A,
 * OQ-11 = A; FR-060, FR-061).
 *
 * The host part gathers the screen's own sections — order-confirmation e-mails, fulfilment
 * strategy, custom fields — into one `PATCH …/organizations/:id` with
 * `expectedUpdatedAt`, and writes the restrictions after it with the version that `PATCH`
 * answered. Then the participants, in zone order: `price_lists`' display mode (200),
 * `quick_order`'s ordering defaults (300), `quote_requests`' price negotiation (500). The three
 * participants are the real contributions, through the packages' own `contributions`. Every write
 * lands in one ordered log, so "the host first, then the panels" is the order of that log.
 *
 * Issue #1468 (SALES-01, DEC-07) — the organization status and the VAT status are no longer
 * host sections: moderation is the status's one writer, and the VAT status is read-only in the
 * header and changed by its own immediate "Change VAT status…" dialog.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
const putSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();
const writes: string[] = [];

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => {
        writes.push(`POST ${String(args[0])}`);
        return postSpy(...args);
      },
      put: (...args: unknown[]) => {
        writes.push(`PUT ${String(args[0])}`);
        return putSpy(...args);
      },
      patch: (...args: unknown[]) => {
        writes.push(`PATCH ${String(args[0])}`);
        return patchSpy(...args);
      },
      delete: (...args: unknown[]) => {
        writes.push(`DELETE ${String(args[0])}`);
        return deleteSpy(...args);
      },
    },
  };
});

// Data-heavy siblings that are not under test and write nothing on mount.
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
const bundle = {
  core: coreEn,
  organizations: orgEn,
  price_lists: read('../packages/modules/price_lists/i18n/en.json'),
  quick_order: read('../packages/modules/quick_order/i18n/en.json'),
  quote_requests: read('../packages/modules/quote_requests/i18n/en.json'),
};

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const UPDATED_AT = '2026-05-01T09:00:00.000Z';
const PM = '00000000-0000-4000-8000-00000000e001';
const DM = '00000000-0000-4000-8000-00000000e002';
const WH = '00000000-0000-4000-8000-00000000e003';

const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;
const RESTRICTIONS_URL = `${ORG_URL}/restrictions`;
const MODE_URL = `/api/v1/admin/pricing/display-mode-overrides/organization/${ORG_ID}`;
const PREFERENCES_URL = '/api/v1/admin/quick-order/preferences';
const NEGOTIATION_URL = `${ORG_URL}/quote-price-negotiation`;

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d003',
  entityType: 'organization',
  key: 'account_manager',
  label: { en: 'Account manager' },
  labelDefault: 'Account manager',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const MEMBER = {
  id: '00000000-0000-4000-8000-0000000000b1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  organizationRole: { id: '00000000-0000-4000-8000-0000000000f1', name: 'Member', kind: 'member' },
  emailVerifiedAt: null,
  twoFactorEnabled: false,
  updatedAt: UPDATED_AT,
};

function initialOrg(): Record<string, unknown> {
  return {
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
    customFieldValues: { account_manager: 'Ada' },
    parentId: null,
    members: [MEMBER],
    version: 3,
    updatedAt: UPDATED_AT,
  };
}

/** The stored organization: a `PATCH` changes it, so the next read answers what was saved. */
let stored: Record<string, unknown> = initialOrg();

function serve(): void {
  getSpy.mockImplementation(async (url: string) => {
    if (url === ORG_URL) return { data: { ...stored } };
    if (url === RESTRICTIONS_URL) {
      return { data: { organizationId: ORG_ID, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [], version: stored['version'] } };
    }
    if (url.startsWith('/api/v1/admin/payment-methods')) return { data: [{ id: PM, code: 'card', name: { en: 'Card' } }] };
    if (url.startsWith('/api/v1/admin/delivery-methods')) return { data: [{ id: DM, code: 'courier', name: { en: 'Courier' } }] };
    if (url.startsWith('/api/v1/admin/warehouses')) return { items: [{ id: WH, code: 'main', name: 'Main' }] };
    if (url === '/api/v1/admin/custom-fields/definitions?entityType=organization') return { data: [DEFINITION] };
    if (url === MODE_URL) return { data: { mode: 'gross_only' } };
    if (url.startsWith(`${PREFERENCES_URL}?`)) return { data: null };
    if (url === `${ORG_URL}/addresses`) return { data: [] };
    if (url === NEGOTIATION_URL) return { data: { organizationId: ORG_ID, priceProposalsAllowed: false, updatedAt: null } };
    const channels = organizationSalesChannelsAnswer(url);
    if (channels) return channels;
    // Hierarchy, roles: an empty list is a valid answer for each.
    return { data: [], items: [] };
  });
  patchSpy.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url !== ORG_URL) throw new Error(`unexpected PATCH ${url}`);
    const { expectedUpdatedAt: _ignored, ...changes } = body;
    stored = { ...stored, ...changes, version: (stored['version'] as number) + 1, updatedAt: '2026-05-01T10:00:00.000Z' };
    return { data: { ...stored } };
  });
  putSpy.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === RESTRICTIONS_URL) {
      stored = { ...stored, version: (stored['version'] as number) + 1 };
      return { data: { organizationId: ORG_ID, ...body, version: stored['version'] } };
    }
    if (url === MODE_URL) return { data: body };
    if (url === PREFERENCES_URL) return { data: body };
    if (url === NEGOTIATION_URL) return { data: { organizationId: ORG_ID, ...body, updatedAt: '2026-05-01T10:00:00.000Z' } };
    throw new Error(`unexpected PUT ${url}`);
  });
}

function renderDetail(
  options: { present?: readonly string[]; absent?: readonly string[]; permissions?: readonly string[] } = {},
): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
      <Routes>
        <Route path="/organizations/:id" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['*'])] }),
      presence: modulePresence({ present: options.present ?? everyDeclaredModule(), absent: [...(options.absent ?? [])] }),
      contributions: [
        { moduleId: 'price_lists', contributions: priceLists.contributions },
        { moduleId: 'quick_order', contributions: quickOrder.contributions },
        { moduleId: 'quote_requests', contributions: quoteRequests.contributions },
      ],
      bundle,
    },
  );
}

const SAVE = /^Save( \d+ changes?)?$|^Saving…$/;
const saveButton = (): HTMLElement => screen.getByRole('button', { name: SAVE });

/** Every panel loaded and its control enabled. */
async function ready(): Promise<void> {
  await screen.findByLabelText('Account manager');
  await waitFor(() => expect((screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!) as HTMLSelectElement).disabled).toBe(false));
  await screen.findByLabelText(coreEn['defaultPreferences.paymentMethod']!);
  await screen.findByLabelText('Card');
  await waitFor(() => expect((screen.getByLabelText(bundle.quote_requests['negotiation.organization.label']!) as HTMLInputElement).disabled).toBe(false));
}

const EMAILS_LABEL = orgEn['detail.orderConfirmationEmails']!;
const emailsField = (): HTMLElement => screen.getByLabelText(EMAILS_LABEL);

/** Edit every host section and every participant: seven changes. */
async function editEverything(): Promise<void> {
  const emails = emailsField();
  fireEvent.change(emails, { target: { value: 'ops@example.com\nsales@example.com' } });
  fireEvent.blur(emails);
  fireEvent.change(screen.getByLabelText(coreEn['fulfilment.label']!), { target: { value: 'any' } });
  fireEvent.change(screen.getByLabelText('Account manager'), { target: { value: 'Bea' } });
  fireEvent.click(screen.getByLabelText('Card'));
  fireEvent.change(screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!), { target: { value: 'net_only' } });
  fireEvent.change(screen.getByLabelText(coreEn['defaultPreferences.paymentMethod']!), { target: { value: PM } });
  fireEvent.click(screen.getByLabelText(bundle.quote_requests['negotiation.organization.label']!));
}

beforeEach(() => {
  writes.length = 0;
  stored = initialOrg();
  getSpy.mockReset();
  patchSpy.mockReset();
  putSpy.mockReset();
  postSpy.mockReset().mockResolvedValue({ data: {} });
  deleteSpy.mockReset().mockResolvedValue(undefined);
  serve();
});
afterEach(() => cleanup());

describe('organization detail — one Save (feature 180, WP-7)', () => {
  it('offers one Save and no other Save of a section or a panel', async () => {
    renderDetail();
    await ready();
    expect(saveButton()).toHaveAccessibleName('Save');
    // One button named Save — the fulfilment panel's own was named "Save" too.
    expect(screen.getAllByRole('button', { name: SAVE })).toHaveLength(1);
    for (const key of ['customFields.save', 'organizations.restrictions.action.save', 'defaultPreferences.save']) {
      expect(screen.queryByRole('button', { name: coreEn[key]! })).toBeNull();
    }
    // Issue #1305 — the sales-channels panel had a Save of its own too.
    expect(screen.queryByRole('button', { name: /sales channels/i })).toBeNull();
  });

  it('applies a sales-channel tick at once and leaves the page Save count alone (issue #1305)', async () => {
    const CHANNELS_URL = `${ORG_URL}/sales-channels`;
    const RETAIL = '00000000-0000-4000-8000-00000000c001';
    const TRADE = '00000000-0000-4000-8000-00000000c002';
    const answer = (assigned: string[]) => ({
      data: {
        organizationId: ORG_ID,
        assignedSalesChannelIds: assigned,
        options: [
          { id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true },
          { id: TRADE, code: 'trade', name: { 'en-US': 'Trade' }, active: true, systemDefault: false },
        ],
      },
    });
    const base = getSpy.getMockImplementation()!;
    getSpy.mockImplementation(async (url: string) => (url === CHANNELS_URL ? answer([RETAIL]) : base(url)));
    const basePut = putSpy.getMockImplementation()!;
    putSpy.mockImplementation(async (url: string, body: Record<string, unknown>) =>
      url === CHANNELS_URL ? answer(body['salesChannelIds'] as string[]) : basePut(url, body),
    );
    renderDetail();
    await ready();
    fireEvent.change(emailsField(), { target: { value: 'ops@example.com' } });
    await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save 1 change'));

    const trade = await screen.findByRole('checkbox', { name: /Trade/ });
    fireEvent.click(trade);
    await waitFor(() => expect(writes).toEqual([`PUT ${CHANNELS_URL}`]));
    expect(putSpy).toHaveBeenCalledWith(CHANNELS_URL, { salesChannelIds: [RETAIL, TRADE] });
    await waitFor(() => expect(trade.getAttribute('aria-busy')).toBeNull());
    expect(trade).toBeChecked();
    // The tick is not a staged change: the count still counts only the e-mails.
    expect(saveButton()).toHaveAccessibleName('Save 1 change');
    expect(emailsField()).toHaveValue('ops@example.com');
  });

  it('writes nothing on change or on blur; Save counts every change', async () => {
    renderDetail();
    await ready();
    await editEverything();
    // The e-mails' blur, the display-mode select and the negotiation checkbox all used to
    // write at once.
    expect(writes).toEqual([]);
    // e-mails, fulfilment, custom field, restrictions (one list) — four host changes — plus the
    // three participants.
    expect(saveButton()).toHaveAccessibleName('Save 7 changes');
  });

  it('writes the host part first — one PATCH with expectedUpdatedAt, then the restrictions — then the panels in zone order', async () => {
    renderDetail();
    await ready();
    await editEverything();
    fireEvent.click(saveButton());

    await waitFor(() => expect(writes).toHaveLength(5));
    expect(writes).toEqual([
      `PATCH ${ORG_URL}`,
      `PUT ${RESTRICTIONS_URL}`,
      `PUT ${MODE_URL}`,
      `PUT ${PREFERENCES_URL}`,
      `PUT ${NEGOTIATION_URL}`,
    ]);
    expect(patchSpy).toHaveBeenCalledTimes(1);
    // Never the status or the VAT status (#1468).
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({
      orderConfirmationEmails: ['ops@example.com', 'sales@example.com'],
      fulfilmentStrategy: 'any',
      fulfilmentStrategyWarehouseOrder: null,
      customFieldValues: { account_manager: 'Bea' },
      expectedUpdatedAt: UPDATED_AT,
    });
    // The restrictions carry the version the PATCH answered, not the one first read.
    expect(putSpy.mock.calls.find(([url]) => url === RESTRICTIONS_URL)?.[1]).toEqual({
      expectedVersion: 4,
      paymentMethodIds: [PM],
      deliveryMethodIds: [],
      warehouseIds: [],
    });
    expect(putSpy.mock.calls.find(([url]) => url === MODE_URL)?.[1]).toEqual({ mode: 'net_only' });
    expect(putSpy.mock.calls.find(([url]) => url === PREFERENCES_URL)?.[1]).toMatchObject({
      scope: 'organization',
      scopeId: ORG_ID,
      defaultPaymentMethodId: PM,
    });
    expect(putSpy.mock.calls.find(([url]) => url === NEGOTIATION_URL)?.[1]).toEqual({ priceProposalsAllowed: true });
    await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save'));
  });

  // Issue #1499 (SALES-17, DEC-12 a) — "Saved" is said beside Save, in the header, in a
  // region mounted empty from the first render — not as a success banner above the page.
  it('says "Saved" beside Save and puts no success banner on the page', async () => {
    renderDetail();
    await ready();
    const header = saveButton().closest('header')!;
    const region = within(header).getByRole('status');
    expect(region.textContent).toBe('');
    fireEvent.change(emailsField(), { target: { value: 'ops@example.com' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(region).toHaveTextContent(coreEn['organizations.detail.info.saved']!));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
    // The next edit is a new draft: the old "Saved" goes.
    fireEvent.change(emailsField(), { target: { value: 'ops@example.com\nx@example.com' } });
    expect(region.textContent).toBe('');
  });

  it('sends only what changed: a lone custom field is a lone PATCH', async () => {
    renderDetail();
    await ready();
    fireEvent.change(screen.getByLabelText('Account manager'), { target: { value: 'Bea' } });
    expect(saveButton()).toHaveAccessibleName('Save 1 change');
    fireEvent.click(saveButton());
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({ customFieldValues: { account_manager: 'Bea' }, expectedUpdatedAt: UPDATED_AT });
    await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save'));
    expect(writes).toEqual([`PATCH ${ORG_URL}`]);
  });

  it('writes the restrictions alone with the version first read when nothing else of the host changed', async () => {
    renderDetail();
    await ready();
    fireEvent.click(screen.getByLabelText('Courier'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).not.toHaveBeenCalled();
    expect(putSpy.mock.calls[0]).toEqual([
      RESTRICTIONS_URL,
      { expectedVersion: 3, paymentMethodIds: [], deliveryMethodIds: [DM], warehouseIds: [] },
    ]);
  });

  it('writes only a participant when only a participant changed', async () => {
    renderDetail();
    await ready();
    fireEvent.change(screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!), { target: { value: 'both' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(writes).toEqual([`PUT ${MODE_URL}`]);
  });

  it('a VERSION_CONFLICT on the host write writes no panel, reloads and discards every change, and says so', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'Organization was modified.', requestId: 'r' } } as never),
    );
    renderDetail();
    await ready();
    await editEverything();
    const readsBefore = getSpy.mock.calls.filter(([url]) => url === ORG_URL).length;
    fireEvent.click(saveButton());

    expect(await screen.findByText(orgEn['detail.save.conflict']!)).toBeInTheDocument();
    expect(writes).toEqual([`PATCH ${ORG_URL}`]);
    // Reloaded, and every change on the page is gone.
    expect(getSpy.mock.calls.filter(([url]) => url === ORG_URL).length).toBeGreaterThan(readsBefore);
    await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save'));
    expect(emailsField()).toHaveValue('');
    expect(await screen.findByLabelText('Account manager')).toHaveValue('Ada');
    await waitFor(() => expect(screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!)).toHaveValue('gross_only'));
    await waitFor(() => expect(screen.getByLabelText('Card')).not.toBeChecked());
  });

  it('a VERSION_CONFLICT on the restrictions write writes no panel either', async () => {
    putSpy.mockImplementation(async (url: string) => {
      if (url === RESTRICTIONS_URL) {
        throw new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'Organization was modified.', requestId: 'r' } } as never);
      }
      return { data: {} };
    });
    renderDetail();
    await ready();
    fireEvent.click(screen.getByLabelText('Card'));
    fireEvent.change(screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!), { target: { value: 'both' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(orgEn['detail.save.conflict']!)).toBeInTheDocument();
    expect(writes).toEqual([`PUT ${RESTRICTIONS_URL}`]);
  });

  it('keeps the host saved when a panel write fails, and retries only that panel', async () => {
    putSpy.mockImplementation(async (url: string, body: unknown) => {
      if (url === MODE_URL && putSpy.mock.calls.filter(([u]) => u === MODE_URL).length === 1) {
        throw new ApiError(500, { error: { code: 'INTERNAL', message: 'The server failed.', requestId: 'r' } } as never);
      }
      return { data: body };
    });
    renderDetail();
    await ready();
    fireEvent.change(emailsField(), { target: { value: 'ops@example.com' } });
    fireEvent.change(screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!), { target: { value: 'both' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(coreEn['saveSession.summary.partial']!)).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save 1 change'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy.mock.calls.filter(([u]) => u === MODE_URL)).toHaveLength(2));
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the immediate sections immediate, each labelled so', async () => {
    renderDetail();
    await ready();
    const badge = coreEn['saveSession.immediateBadge']!;
    for (const title of [
      // Issue #1516 (SALES-14) — inviting and creating a member are the Members section's
      // *Add member* dialog now, not two cards of their own.
      coreEn['organizations.detail.membersCard']!,
      coreEn['organizations.detail.hierarchyCard']!,
      coreEn['organizations.moderation.title']!,
      orgEn['salesChannels.title']!,
    ]) {
      // The title's own text, so the badge beside it is in the heading's text content.
      const heading = await screen.findByText(title);
      expect(heading.textContent, title).toContain(badge);
    }
    // The section Save covers carry none.
    const notificationsTitle = screen.getByText(coreEn['organizations.detail.notificationsCard']!);
    expect(notificationsTitle.textContent).not.toContain(badge);

    // Removing a member still applies at once, and a staged host change stays staged.
    fireEvent.change(emailsField(), { target: { value: 'ops@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: orgEn['members.row.remove']!.replace('{email}', MEMBER.email) }));
    // Issue #1516 — asked first, then applied at once.
    await answerConfirm(true);
    await waitFor(() => expect(writes).toEqual([`DELETE ${ORG_URL}/members/${MEMBER.id}`]));
    await waitFor(() => expect(saveButton()).toHaveAccessibleName('Save 1 change'));
    expect(emailsField()).toHaveValue('ops@example.com');
  });

  it('without customers:manage the screen\'s own sections are read-only and there is no Save', async () => {
    renderDetail({ permissions: ['customers:read', 'custom_fields:read', 'price_lists:read'] });
    await screen.findByText('Ada');
    await screen.findByLabelText('Card');
    for (const control of [
      emailsField(),
      screen.getByLabelText(coreEn['fulfilment.label']!),
      screen.getByLabelText('Card'),
    ]) {
      expect(control).toBeDisabled();
    }
    // The custom field is shown as its value, with no input to type into.
    expect(screen.queryByRole('textbox', { name: 'Account manager' })).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    // Neither the moderation actions nor the VAT status change are offered (#1468).
    expect(screen.queryByRole('button', { name: coreEn['organizations.moderation.action.block']! })).toBeNull();
    expect(screen.queryByRole('button', { name: orgEn['changeVatStatus.button']! })).toBeNull();
    expect(writes).toEqual([]);
  });

  it('asks before the page is left with unsaved changes', async () => {
    renderDetail();
    await ready();
    fireEvent.change(screen.getByLabelText(coreEn['priceLists.displayMode.rowLabel']!), { target: { value: 'both' } });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('has no status or VAT status control; the header shows the VAT status as text (#1468)', async () => {
    renderDetail();
    await ready();
    expect(screen.queryByLabelText('Account status')).toBeNull();
    expect(screen.queryByLabelText(coreEn['organizations.detail.vatStatus']!)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /status/i })).toBeNull();
    const vat = screen.getByText(orgEn['vatStatus.vat_payer']!);
    expect(vat.parentElement?.textContent).toContain(`${coreEn['organizations.detail.vatStatus']!}:`);
    // The moderation panel is the one place the organization status is shown and changed.
    expect(screen.getByRole('button', { name: coreEn['organizations.moderation.action.block']! })).toBeEnabled();
  });

  it('shows the VAT status in the header of a personal organization too', async () => {
    stored = { ...initialOrg(), name: 'Jan Kowalski', taxId: null, isPersonal: true, vatStatus: 'vat_exempt' };
    renderDetail();
    await ready();
    const vat = screen.getByText(orgEn['vatStatus.vat_exempt']!);
    expect(vat.parentElement?.textContent).toContain(`${coreEn['organizations.detail.vatStatus']!}:`);
  });

  it('"Show" on a refused host part focuses the order-confirmation e-mails', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(400, { error: { code: 'VALIDATION_ERROR', message: 'Refused.', requestId: 'r' } } as never),
    );
    renderDetail();
    await ready();
    fireEvent.change(emailsField(), { target: { value: 'ops@example.com' } });
    fireEvent.click(saveButton());
    const show = await screen.findByRole('button', { name: new RegExp(coreEn['saveSession.summary.show']!) });
    fireEvent.click(show);
    await waitFor(() => expect(document.activeElement?.id).toBe('orderConfEmails'));
  });
});
