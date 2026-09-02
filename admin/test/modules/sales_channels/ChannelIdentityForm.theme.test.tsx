import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { STOREFRONT_THEME_CODES, type SalesChannelDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature `005-sales-channels` — the theme field offers the themes that exist.
 *
 * It was a free-text input, because when it shipped there was no list of themes
 * to offer: `theme_code` was validated against a shape regex and read by
 * nothing. An operator could type `industria-pro` and save it, and the shop
 * looked exactly the same afterwards. Now the storefront implements a fixed set
 * of token blocks and `STOREFRONT_THEME_CODES` names them, so the control is a
 * list — a text box here would still be able to store a value nothing renders,
 * which is the defect rather than a cosmetic detail.
 */

// The form builds its two dictionary requests itself since feature 091's P6 —
// it no longer imports `dictionaries`' admin API client, so the seam a test can
// isolate is `apiClient`. The stub answers **by URL**, which makes the mock a
// behavioural check on the rebuilt paths: a caller that names the wrong one
// throws rather than quietly rendering an empty list.
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
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

const { ChannelIdentityForm } = await import(
  '../../../src/modules/sales_channels/components/ChannelIdentityForm'
);

// `process.cwd()` rather than `import.meta.url`: this suite runs under jsdom,
// where `import.meta.url` is an http URL and `fileURLToPath` refuses it. Vitest
// runs each workspace from its own root, so the cwd is `admin/`.
const enBundlePath = resolve(
  process.cwd(),
  '../packages/modules/sales_channels/i18n/en.json',
);
const plBundlePath = enBundlePath.replace('en.json', 'pl.json');
const en = JSON.parse(readFileSync(enBundlePath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(plBundlePath, 'utf8')) as Record<string, string>;

const bundle = { sales_channels: en };

function channel(themeCode: string | null): SalesChannelDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'serwis-a',
    name: { 'en-US': 'Serwis A' },
    active: true,
    systemDefault: false,
    defaultLanguage: 'en-US',
    defaultCurrency: 'PLN',
    themeCode,
    logoAssetId: null,
    version: 1,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    languages: ['en-US'],
    currencies: ['PLN'],
    logoUrl: null,
  };
}

function themeSelect(): HTMLSelectElement {
  const el = document.getElementById('sc-theme');
  expect(el).not.toBeNull();
  return el as HTMLSelectElement;
}

describe('the sales-channel theme control', () => {
  it('is a list, not a free-text box', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="create" onSubmit={() => undefined} />,
      bundle,
    );
    expect(themeSelect().tagName).toBe('SELECT');
  });

  it('offers exactly the themes the storefront implements, plus "no theme"', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="create" onSubmit={() => undefined} />,
      bundle,
    );
    const values = [...themeSelect().options].map((o) => o.value);
    expect(values).toEqual(['', ...STOREFRONT_THEME_CODES]);
  });

  it('keeps a stored code the storefront no longer ships, and labels it as such', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="edit" initial={channel('industria-pro')} onSubmit={() => undefined} />,
      bundle,
    );
    const select = themeSelect();
    // Selected — opening the form must not quietly re-point the channel at a
    // different theme — and visibly not one of the shipped sets.
    expect(select.value).toBe('industria-pro');
    expect([...select.options].map((o) => o.value)).toContain('industria-pro');
    expect(screen.getByText(/industria-pro/)).toBeInTheDocument();
  });

  it('does not duplicate a stored code that the storefront does ship', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="edit" initial={channel('nordic')} onSubmit={() => undefined} />,
      bundle,
    );
    const values = [...themeSelect().options].map((o) => o.value);
    expect(values.filter((v) => v === 'nordic')).toHaveLength(1);
  });
});

describe('the theme control ships both shipped languages', () => {
  it('has an en and a pl string for every key the control renders', () => {
    const keys = [
      'identity.theme.label',
      'identity.theme.none',
      'identity.theme.help',
      'identity.theme.unknown',
      ...STOREFRONT_THEME_CODES.map((code) => `identity.theme.option.${code}`),
    ];
    for (const key of keys) {
      expect(en[key], `missing en: ${key}`).toBeTruthy();
      expect(pl[key], `missing pl: ${key}`).toBeTruthy();
    }
  });

  it('no longer ships the placeholder key of the free-text box', () => {
    expect(en['identity.theme.placeholder']).toBeUndefined();
    expect(pl['identity.theme.placeholder']).toBeUndefined();
  });
});
