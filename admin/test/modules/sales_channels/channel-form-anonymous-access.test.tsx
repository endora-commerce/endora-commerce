import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SalesChannelDetail, SalesChannelSummary } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * `specs/154-sales-channel-access/` T058 — the operator's switch for a store
 * closed to anonymous visitors (contracts/admin-api-and-ui.md §1, US5).
 *
 * The form carries *Open to anonymous visitors* under *Active*, on for a new
 * channel, with the hint that says what turning it off does (sign-in required,
 * Organization assignment decides). Whether an anonymous visitor sees prices
 * is not this control's question: a second hint points at the guest display
 * mode in *Pricing settings*, where the retired public-channel flag's job went
 * (issues #467 and #492).
 *
 * The edit page sends the value in the update body, and the roster marks a
 * closed channel with a *Sign-in required* badge, so a closed store is visible
 * without opening it.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: async (url: string) => {
        if (url.startsWith('/api/v1/admin/dictionary/languages')) return { data: [] };
        if (url.startsWith('/api/v1/admin/dictionary/currencies')) return { data: [] };
        throw new Error(`unexpected request: ${url}`);
      },
    },
  };
});

const getByCodeSpy = vi.fn();
const updateSpy = vi.fn();
const createSpy = vi.fn();
const listSpy = vi.fn();

vi.mock('../../../../packages/modules/sales_channels/src/admin/api/sales-channels-client', () => ({
  salesChannelsClient: {
    getByCode: (...a: unknown[]) => getByCodeSpy(...a),
    update: (...a: unknown[]) => updateSpy(...a),
    create: (...a: unknown[]) => createSpy(...a),
    list: (...a: unknown[]) => listSpy(...a),
  },
}));

const { ChannelIdentityForm } = await import(
  '../../../../packages/modules/sales_channels/src/admin/components/ChannelIdentityForm'
);
const { SalesChannelEditPage } = await import(
  '../../../../packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage'
);
const { SalesChannelsListPage } = await import(
  '../../../../packages/modules/sales_channels/src/admin/pages/SalesChannelsListPage'
);

// `process.cwd()` is `admin/` under the admin workspace's vitest run.
const enBundlePath = resolve(process.cwd(), '../packages/modules/sales_channels/i18n/en.json');
const en = JSON.parse(readFileSync(enBundlePath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(enBundlePath.replace('en.json', 'pl.json'), 'utf8')) as Record<
  string,
  string
>;
const bundle = { sales_channels: en };

const NEW_KEYS = [
  'identity.anonymousAccess.label',
  'identity.anonymousAccess.hint',
  'identity.anonymousAccess.pricesHint',
  'identity.anonymousAccess.pricesLink',
  'list.badge.signInRequired',
] as const;

function channel(over: Partial<SalesChannelDetail> = {}): SalesChannelDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'serwis-a',
    name: { 'en-US': 'Serwis A' },
    active: true,
    anonymousAccess: true,
    prefixDefaultLanguage: true,
    systemDefault: false,
    defaultLanguage: 'en-US',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    version: 3,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    languages: ['en-US'],
    currencies: ['PLN'],
    logoUrl: null,
    ...over,
  };
}

function anonymousSwitch(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: en['identity.anonymousAccess.label']! });
}

beforeEach(() => {
  getByCodeSpy.mockReset();
  updateSpy.mockReset();
  createSpy.mockReset();
  listSpy.mockReset();
});

describe('bundle', () => {
  it('ships every new key in English and Polish', () => {
    for (const key of NEW_KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
    expect(en['identity.anonymousAccess.label']).toBe('Open to anonymous visitors');
    expect(pl['identity.anonymousAccess.label']).toBe('Otwarty dla niezalogowanych odwiedzających');
    // The hint used to point at a "show prices to anonymous visitors" setting
    // the admin never had (issue #467); it names no price setting now.
    expect(en['identity.anonymousAccess.hint']).not.toMatch(/price/i);
    expect(pl['identity.anonymousAccess.hint']).not.toMatch(/cen/i);
    // Issue #492 — the price question has its own hint, naming the setting
    // that answers it.
    expect(en['identity.anonymousAccess.pricesHint']).toMatch(/display mode/i);
    expect(pl['identity.anonymousAccess.pricesHint']).toMatch(/tryb wyświetlania/i);
  });
});

describe('ChannelIdentityForm — Open to anonymous visitors', () => {
  it('is present, on for a new channel, and described by its hints', async () => {
    const { container } = renderWithI18n(
      <StrictMode>
        <MemoryRouter>
          <ChannelIdentityForm mode="create" onSubmit={() => undefined} />
        </MemoryRouter>
      </StrictMode>,
      bundle,
    );
    const input = anonymousSwitch();
    expect(input.checked).toBe(true);
    const hintIds = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(hintIds).toHaveLength(2);
    expect(document.getElementById(hintIds[0]!)?.textContent).toBe(en['identity.anonymousAccess.hint']);
    expect(document.getElementById(hintIds[1]!)?.textContent).toBe(
      `${en['identity.anonymousAccess.pricesHint']} ${en['identity.anonymousAccess.pricesLink']}`,
    );
    await expectNoAxeViolations(container);
  });

  it('points the price question at the guest display mode in Pricing settings (#492)', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="create" onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    const link = screen.getByRole('link', { name: en['identity.anonymousAccess.pricesLink']! });
    expect(link.getAttribute('href')).toBe('/price-lists/display-modes');
  });

  it('reflects a closed channel and submits the operator\'s choice', () => {
    let submitted: { anonymousAccess: boolean } | null = null;
    renderWithI18n(
      <StrictMode>
        <MemoryRouter>
          <ChannelIdentityForm
            mode="edit"
            initial={channel({ anonymousAccess: false })}
            onSubmit={(value) => {
              submitted = value;
            }}
          />
        </MemoryRouter>
      </StrictMode>,
      bundle,
    );
    const input = anonymousSwitch();
    expect(input.checked).toBe(false);
    fireEvent.click(input);
    expect(input.checked).toBe(true);
    fireEvent.submit(input.closest('form')!);
    expect(submitted).not.toBeNull();
    expect(submitted!.anonymousAccess).toBe(true);
  });

  it('is editable on the system-default channel, unlike Active', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm
          mode="edit"
          initial={channel({ systemDefault: true })}
          onSubmit={() => undefined}
        />
      </MemoryRouter>,
      bundle,
    );
    expect(anonymousSwitch().disabled).toBe(false);
  });
});

describe('SalesChannelEditPage — saving', () => {
  it('sends anonymousAccess in the update body', async () => {
    getByCodeSpy.mockResolvedValue(channel());
    updateSpy.mockImplementation(async (_code: string, body: { anonymousAccess: boolean }) =>
      channel({ anonymousAccess: body.anonymousAccess, version: 4 }),
    );
    renderWithSession(
      <StrictMode>
        <MemoryRouter initialEntries={['/sales-channels/serwis-a']}>
          <Routes>
            <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['sales_channels'] }),
        // The Save button's count is the kit's copy (feature 180, WP-9).
        bundle: { ...bundle, ...shippedCoreBundle('en') },
      },
    );
    // The form re-seeds its fields from the loaded channel in an effect. Under
    // load that effect can still be pending when the checkbox is clicked, and
    // it then puts the loaded value back. `findByRole` settles the page —
    // pending effects included — so the click lands after the re-seed.
    await screen.findByRole('button', { name: 'Delete' });
    await waitFor(() => expect(anonymousSwitch().checked).toBe(true));
    fireEvent.click(anonymousSwitch());
    // Feature 180, WP-9 — the edit form's Save counts its changes ("Save 1 change").
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0]![0]).toBe('serwis-a');
    expect(updateSpy.mock.calls[0]![1]).toMatchObject({ expectedVersion: 3, anonymousAccess: false });
  });

  it('sends anonymousAccess in the create body', async () => {
    createSpy.mockResolvedValue(channel({ code: 'b2b', anonymousAccess: false }));
    getByCodeSpy.mockResolvedValue(channel({ code: 'b2b', anonymousAccess: false }));
    renderWithSession(
      <MemoryRouter initialEntries={['/sales-channels/new']}>
        <Routes>
          <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['sales_channels'] }),
        bundle,
      },
    );
    fireEvent.change(document.getElementById('sc-code')!, { target: { value: 'b2b' } });
    fireEvent.change(document.getElementById('sc-name')!, { target: { value: 'B2B' } });
    fireEvent.click(anonymousSwitch());
    fireEvent.submit(anonymousSwitch().closest('form')!);
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0]![0]).toMatchObject({ code: 'b2b', anonymousAccess: false });
  });
});

describe('SalesChannelsListPage — roster badge', () => {
  it('badges a channel closed to anonymous visitors, and only that one', async () => {
    const open: SalesChannelSummary = channel({ code: 'retail', systemDefault: true });
    const closed: SalesChannelSummary = channel({
      id: '00000000-0000-4000-8000-000000000002',
      code: 'trade',
      anonymousAccess: false,
    });
    listSpy.mockResolvedValue({ items: [open, closed] });
    const { container } = renderWithSession(
      <StrictMode>
        <MemoryRouter>
          <SalesChannelsListPage />
        </MemoryRouter>
      </StrictMode>,
      { session: adminSession({ permissions: ['sales_channels:read'] }), bundle },
    );
    const closedRow = (await screen.findByText('trade')).closest('tr')!;
    const openRow = screen.getByText('retail').closest('tr')!;
    expect(within(closedRow).getByText(en['list.badge.signInRequired']!)).toBeTruthy();
    expect(within(openRow).queryByText(en['list.badge.signInRequired']!)).toBeNull();
    await expectNoAxeViolations(container);
  });
});
