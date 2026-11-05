import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SalesChannelDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/167-storefront-locale-path/` US3 (T045) — the operator's switch *Prefix the
 * default language in URLs* on the channel form: on for a new channel, described by
 * a hint, read-only without `sales_channels:write`, with the derived prefix of every
 * channel language listed and a warning that changing the languages or the switch
 * changes the storefront's URLs. The value travels in the create and update bodies.
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

vi.mock('../../../../packages/modules/sales_channels/src/admin/api/sales-channels-client', () => ({
  salesChannelsClient: {
    getByCode: (...a: unknown[]) => getByCodeSpy(...a),
    update: (...a: unknown[]) => updateSpy(...a),
    create: (...a: unknown[]) => createSpy(...a),
    list: vi.fn(),
  },
}));

const { ChannelIdentityForm } = await import(
  '../../../../packages/modules/sales_channels/src/admin/components/ChannelIdentityForm'
);
const { SalesChannelEditPage } = await import(
  '../../../../packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage'
);

const enBundlePath = resolve(process.cwd(), '../packages/modules/sales_channels/i18n/en.json');
const en = JSON.parse(readFileSync(enBundlePath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(enBundlePath.replace('en.json', 'pl.json'), 'utf8')) as Record<string, string>;
const bundle = { sales_channels: en };

const KEYS = [
  'identity.prefixDefaultLanguage.label',
  'identity.prefixDefaultLanguage.hint',
  'identity.prefixDefaultLanguage.prefixesHeading',
  'identity.prefixDefaultLanguage.urlChangeWarning',
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
    defaultLanguage: 'pl-PL',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    version: 3,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    languages: ['pl-PL', 'en-US', 'en-GB'],
    currencies: ['PLN'],
    logoUrl: null,
    ...over,
  };
}

function prefixSwitch(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: en['identity.prefixDefaultLanguage.label']! });
}

beforeEach(() => {
  getByCodeSpy.mockReset();
  updateSpy.mockReset();
  createSpy.mockReset();
});

describe('bundle', () => {
  it('ships every key in English and Polish, with the owner-ruled labels', () => {
    for (const key of KEYS) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
    expect(en['identity.prefixDefaultLanguage.label']).toBe('Prefix the default language in URLs');
    expect(pl['identity.prefixDefaultLanguage.label']).toBe('Prefiks języka domyślnego w adresach URL');
  });
});

describe('ChannelIdentityForm — Prefix the default language in URLs', () => {
  it('is present, on for a new channel, and described by its hint', async () => {
    const { container } = renderWithI18n(
      <StrictMode>
        <MemoryRouter>
          <ChannelIdentityForm mode="create" onSubmit={() => undefined} />
        </MemoryRouter>
      </StrictMode>,
      bundle,
    );
    const input = prefixSwitch();
    expect(input.checked).toBe(true);
    const hintIds = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(hintIds.map((id) => document.getElementById(id)?.textContent)).toContain(
      en['identity.prefixDefaultLanguage.hint'],
    );
    await expectNoAxeViolations(container);
  });

  it('lists the derived prefix of every channel language and warns that URLs change (US3 #4)', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="edit" initial={channel()} onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    const list = screen.getByRole('list', { name: en['identity.prefixDefaultLanguage.prefixesHeading']! });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'pl-PL → /pl',
      'en-US → /en-us',
      'en-GB → /en-gb',
    ]);
    expect(screen.getByText(en['identity.prefixDefaultLanguage.urlChangeWarning']!)).toBeTruthy();
  });

  it('marks the unprefixed default language when the switch is off', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm
          mode="edit"
          initial={channel({ prefixDefaultLanguage: false, languages: ['pl-PL', 'en-US'] })}
          onSubmit={() => undefined}
        />
      </MemoryRouter>,
      bundle,
    );
    const list = screen.getByRole('list', { name: en['identity.prefixDefaultLanguage.prefixesHeading']! });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['pl-PL → /', 'en-US → /en']);
  });

  it('is read-only for an operator without sales_channels:write (US3 #3)', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="edit" initial={channel()} readOnly onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    expect(prefixSwitch().disabled).toBe(true);
  });

  it("submits the operator's choice", () => {
    let submitted: { prefixDefaultLanguage: boolean } | null = null;
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm
          mode="edit"
          initial={channel()}
          onSubmit={(value) => {
            submitted = value;
          }}
        />
      </MemoryRouter>,
      bundle,
    );
    fireEvent.click(prefixSwitch());
    fireEvent.submit(prefixSwitch().closest('form')!);
    expect(submitted!.prefixDefaultLanguage).toBe(false);
  });
});

describe('SalesChannelEditPage', () => {
  function renderPage(permissions: string[]) {
    getByCodeSpy.mockResolvedValue(channel());
    updateSpy.mockImplementation(async (_code: string, body: { prefixDefaultLanguage: boolean }) =>
      channel({ prefixDefaultLanguage: body.prefixDefaultLanguage, version: 4 }),
    );
    renderWithSession(
      <MemoryRouter initialEntries={['/sales-channels/serwis-a']}>
        <Routes>
          <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['sales_channels'] }),
        bundle,
      },
    );
  }

  it('sends prefixDefaultLanguage in the update body', async () => {
    renderPage(['*']);
    await waitFor(() => expect(prefixSwitch().checked).toBe(true));
    fireEvent.click(prefixSwitch());
    fireEvent.submit(prefixSwitch().closest('form')!);
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy.mock.calls[0]![1]).toMatchObject({ prefixDefaultLanguage: false });
  });

  /**
   * Issue #764. Resolve on the very commit that first shows the switch, from a
   * MutationObserver callback, so the test resumes in a microtask — before
   * React's scheduler has run that commit's passive effects. That is the window
   * `waitFor` lands in under CI load, where its trailing `setTimeout(0)` beats
   * the scheduler's `setImmediate`.
   */
  function switchCommitted(): Promise<void> {
    const name = en['identity.prefixDefaultLanguage.label']!;
    return new Promise((resolveCommitted) => {
      const observer = new MutationObserver(() => {
        if (screen.queryByRole('checkbox', { name })) {
          observer.disconnect();
          resolveCommitted();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  it("keeps the operator's change when the loaded channel's re-seed lands after it (#764)", async () => {
    renderPage(['*']);
    await switchCommitted();
    expect(prefixSwitch().checked).toBe(true);
    fireEvent.click(prefixSwitch());
    // Let every pending render and effect of the load run out.
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 50));
    });
    expect(prefixSwitch().checked).toBe(false);
    fireEvent.submit(prefixSwitch().closest('form')!);
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy.mock.calls[0]![1]).toMatchObject({ prefixDefaultLanguage: false });
  });

  it('shows the switch read-only to an operator with sales_channels:read only', async () => {
    renderPage(['sales_channels:read']);
    await waitFor(() => expect(prefixSwitch().disabled).toBe(true));
  });
});
