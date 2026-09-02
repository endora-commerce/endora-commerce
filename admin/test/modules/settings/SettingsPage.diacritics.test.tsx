import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { SettingDto, SettingGroupDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Issue #239 — the settings filter is the highest-traffic client-side list
 * filter in the admin, and it searched **translated** copy with a bare
 * `toLowerCase().includes()`.
 *
 * Every setting name and description on this screen comes from a module's own
 * `i18n` bundle, so on a Polish installation the whole list is Polish. A
 * fold that leaves `ł` standing means an operator typing `wysylki` — which is
 * what an operator types, because the keyboard is faster without diacritics —
 * gets "no results" for a setting that is right there.
 *
 * The fixtures below are shipped copy, taken verbatim from
 * `backend/src/modules/invoices/i18n/pl.json` and
 * `packages/modules/_i18n/i18n/pl.json`; none of them was invented to fold
 * nicely.
 */

// `SettingsPage` builds its sales-channel request itself since feature 091's
// P6 — it no longer imports `sales_channels`' admin API client, so the seam a
// test can isolate is `apiClient`. Partial, because the page also imports
// `ApiError` from the same module and compares against it with `instanceof`.
const channelsGetSpy = vi.fn(async () => ({ items: [] }));
// The **kit's** barrel, not `@/lib/api-client`. The screen is
// `@endora-commerce/mod-settings/admin`'s since feature 091's batch 10, so it
// resolves `apiClient` there; the admin's own path is a re-export shim of the
// same binding, and mocking a shim leaves the module the screen actually
// imports untouched.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, get: channelsGetSpy } };
});

const listMock = vi.fn();
vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    list: (...args: unknown[]) => listMock(...args),
  },
}));

const { SettingsPage } = await import(
  '../../../../packages/modules/settings/src/admin/pages/SettingsPage'
);

const bundle = passthroughBundle('settings', [
  'page.title',
  'page.description',
  'search.placeholder',
  'search.shortcut',
  'search.noResults',
  'context.label',
  'context.allChannels',
  'context.empty',
  'context.usingDefault',
  'context.globalOverrideSet',
  'groups.expandAll',
  'groups.collapseAll',
  'groups.empty',
  'state.loading',
  'actions.copyCode.label',
  'actions.copyCode.copied',
  'actions.reset',
]);

function setting(overrides: Partial<SettingDto> & Pick<SettingDto, 'code' | 'name'>): SettingDto {
  return {
    id: `00000000-0000-0000-0000-0000000000${overrides.code.length.toString().padStart(2, '0')}`,
    description: null,
    valueType: 'string',
    ownerModule: 'invoices',
    salesChannelCodes: [],
    defaultValue: '',
    globalValue: null,
    valuesByChannel: [],
    version: '2026-08-19T00:00:00.000Z',
    ...overrides,
  } as SettingDto;
}

/**
 * Three shipped Polish setting labels. `Tryb wysyłki faktury mailem` is the
 * one that exercises the stroked `ł`; `Wyślij fakturę mailem po wystawieniu`
 * exercises the ordinary combining marks; the third is the control that must
 * drop out of the list.
 */
const GROUP: SettingGroupDto = {
  id: '00000000-0000-0000-0000-0000000000aa',
  code: 'invoices',
  // `appShell.nav.paymentMethods`, as an operator-renamed settings group.
  name: 'Metody płatności',
  isSystemProtected: false,
  ownerModule: 'invoices',
  salesChannelCodes: [],
  settings: [
    setting({ code: 'invoices.emailDeliveryMode', name: 'Tryb wysyłki faktury mailem' }),
    setting({ code: 'invoices.emailSendOnIssue', name: 'Wyślij fakturę mailem po wystawieniu' }),
    setting({
      code: 'invoices.numberingInvoicePattern',
      name: 'Format numeracji faktur',
      // `settings.storefrontBaseUrl.label`, used here as a description.
      description: 'Bazowy URL Storefront (linki w mailach z fakturą)',
    }),
  ],
};

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('settings search input not found');
  return input;
}

/** The setting names currently rendered, in document order. */
function visibleSettings(): string[] {
  return [...document.querySelectorAll('span.text-sm.font-medium')].map((el) =>
    (el.textContent ?? '').trim(),
  );
}

async function renderPage(): Promise<void> {
  listMock.mockResolvedValue({ groups: [structuredClone(GROUP)] });
  renderWithI18n(<SettingsPage />, bundle);
  await waitFor(() => expect(visibleSettings().length).toBe(3));
}

async function search(query: string): Promise<void> {
  fireEvent.change(searchInput(), { target: { value: query } });
  await waitFor(() => expect(searchInput().value).toBe(query));
}

describe('SettingsPage — diacritic-insensitive filter (issue #239)', () => {
  it('finds a setting whose name carries a stroked ł, typed without it', async () => {
    await renderPage();
    await search('wysylki');
    expect(visibleSettings()).toEqual(['Tryb wysyłki faktury mailem']);
  });

  it('folds ordinary combining diacritics in a setting name', async () => {
    await renderPage();
    await search('wyslij fakture');
    expect(visibleSettings()).toEqual(['Wyślij fakturę mailem po wystawieniu']);
  });

  it('folds a setting description as well as its name', async () => {
    await renderPage();
    await search('faktura');
    expect(visibleSettings()).toEqual(['Format numeracji faktur']);
  });

  it('folds the group name, which surfaces every setting in the group', async () => {
    await renderPage();
    await search('platnosci');
    expect(visibleSettings()).toHaveLength(3);
  });

  it('ignores whitespace around the query', async () => {
    await renderPage();
    await search('  wysylki  ');
    expect(visibleSettings()).toEqual(['Tryb wysyłki faktury mailem']);
  });

  it('still reports no results for a query that matches nothing', async () => {
    await renderPage();
    await search('zamowienia');
    expect(visibleSettings()).toEqual([]);
    expect(screen.getByText('search.noResults')).toBeTruthy();
  });
});
