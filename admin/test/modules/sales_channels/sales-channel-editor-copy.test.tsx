import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SalesChannelDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { shippedCoreBundle } from '../../helpers/core-bundle';

/**
 * Issue #1482 (UX audit 2026-11-17, SHELL-06) — the sales-channel editor's copy.
 *
 * The editor showed operators a page description on both the create and the
 * edit screen, one of them a leftover engineering note, and the form carried a
 * prose wall of help text (Signal-to-Noise). The descriptions are gone, every
 * help line is one line, and the help a control makes redundant is deleted:
 * an inactive Dictionary value is marked "(inactive)" in the picker itself, and
 * the price question is a link, not a paragraph.
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

vi.mock('../../../../packages/modules/sales_channels/src/admin/api/sales-channels-client', () => ({
  salesChannelsClient: {
    getByCode: (...a: unknown[]) => getByCodeSpy(...a),
    update: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
  },
}));

const { ChannelIdentityForm } = await import(
  '../../../../packages/modules/sales_channels/src/admin/components/ChannelIdentityForm'
);
const { SalesChannelEditPage } = await import(
  '../../../../packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage'
);

// `process.cwd()` is `admin/` under the admin workspace's vitest run.
const enBundlePath = resolve(process.cwd(), '../packages/modules/sales_channels/i18n/en.json');
const en = JSON.parse(readFileSync(enBundlePath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(enBundlePath.replace('en.json', 'pl.json'), 'utf8')) as Record<
  string,
  string
>;
const bundle = { sales_channels: en };

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

function renderPage(path: string): void {
  renderWithSession(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales-channels/:code" element={<SalesChannelEditPage />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['sales_channels'] }),
      bundle: { ...bundle, ...shippedCoreBundle('en') },
    },
  );
}

beforeEach(() => {
  getByCodeSpy.mockReset();
});

describe('bundle', () => {
  it('no longer ships the page descriptions or the help the controls make redundant', () => {
    for (const key of [
      'edit.page.createDescription',
      'edit.page.editDescription',
      'list.page.description',
      'identity.title.create',
      'identity.languages.help',
      'identity.currencies.help',
      'identity.anonymousAccess.pricesHint',
    ]) {
      expect(en[key], `en still ships ${key}`).toBeUndefined();
      expect(pl[key], `pl still ships ${key}`).toBeUndefined();
    }
  });

  it('keeps every remaining help line to one line, in both languages', () => {
    for (const key of [
      'identity.code.lockedHelp',
      'identity.theme.help',
      'identity.anonymousAccess.hint',
      'identity.prefixDefaultLanguage.hint',
      'identity.section.locales',
      'identity.section.storefront',
    ]) {
      for (const [lang, messages] of [['en', en], ['pl', pl]] as const) {
        expect(messages[key], `${lang} ${key}`).toBeTruthy();
        expect(messages[key]!.length, `${lang} ${key}: ${messages[key]}`).toBeLessThanOrEqual(80);
      }
    }
  });

  it('ships the code placeholder in both languages', () => {
    expect(en['identity.code.placeholder']).toBeTruthy();
    expect(pl['identity.code.placeholder']).toBeTruthy();
  });
});

describe('SalesChannelEditPage — header', () => {
  it('renders no description on the create screen', async () => {
    renderPage('/sales-channels/new');
    const heading = await screen.findByRole('heading', { level: 1, name: en['edit.page.newTitle']! });
    expect(heading.closest('header')!.querySelectorAll('p')).toHaveLength(0);
  });

  it('renders no description on the edit screen', async () => {
    getByCodeSpy.mockResolvedValue(channel());
    renderPage('/sales-channels/serwis-a');
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('serwis-a');
    expect(heading.closest('header')!.querySelectorAll('p')).toHaveLength(0);
  });
});

describe('ChannelIdentityForm — copy', () => {
  it('names the create card like the edit card, not like the page', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="create" onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    expect(screen.getByText(en['identity.title.edit']!)).toBeTruthy();
  });

  it('takes the code placeholder from the bundle', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="create" onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    const code = document.getElementById('sc-code') as HTMLInputElement;
    expect(code.placeholder).toBe(en['identity.code.placeholder']);
  });

  it('describes a locked code by its one-line hint', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="edit" lockCode initial={channel()} onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    const code = document.getElementById('sc-code') as HTMLInputElement;
    expect(code.disabled).toBe(true);
    const ids = (code.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      en['identity.code.lockedHelp'],
    );
  });

  it('describes the theme field by its one-line hint', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="create" onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    const theme = document.getElementById('sc-theme') as HTMLInputElement;
    const ids = (theme.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      en['identity.theme.help'],
    );
  });
});

/**
 * Issue #1552 (UX audit SHELL-16) — the identity card groups its eleven controls into three
 * sections (Common Region, Chunking) rather than one undivided column of fields and prose.
 */
describe('ChannelIdentityForm — sections (#1552)', () => {
  it('groups the fields into Identity, Languages and currencies, and Storefront sections of one card', () => {
    renderWithI18n(
      <MemoryRouter>
        <ChannelIdentityForm mode="edit" lockCode initial={channel()} onSubmit={() => undefined} />
      </MemoryRouter>,
      bundle,
    );
    const region = (name: string): HTMLElement => screen.getByRole('region', { name });
    const identity = region(en['identity.title.edit']!);
    const locales = region(en['identity.section.locales']!);
    const storefront = region(en['identity.section.storefront']!);
    expect(identity.contains(document.getElementById('sc-code'))).toBe(true);
    expect(identity.contains(document.getElementById('sc-name'))).toBe(true);
    expect(identity.contains(document.getElementById('sc-theme'))).toBe(true);
    expect(locales.contains(document.getElementById('sc-languages'))).toBe(true);
    expect(locales.contains(document.getElementById('sc-default-curr'))).toBe(true);
    expect(storefront.contains(document.getElementById('sc-active'))).toBe(true);
    expect(storefront.contains(document.getElementById('sc-anonymous-access'))).toBe(true);
    expect(storefront.contains(document.getElementById('sc-prefix-default-language'))).toBe(true);
    // One card around the three: sections are never cards of their own inside it.
    const card = identity.closest('[data-slot="card"]');
    expect(card).toBeTruthy();
    expect(card!.contains(storefront)).toBe(true);
    expect(card!.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
  });

  it('ships the section headings in Polish too', () => {
    expect(pl['identity.section.locales']).toBeTruthy();
    expect(pl['identity.section.storefront']).toBeTruthy();
  });
});
