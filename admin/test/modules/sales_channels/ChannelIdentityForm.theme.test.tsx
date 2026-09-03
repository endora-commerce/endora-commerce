import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import type { SalesChannelDetail } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature `specs/102-storefront-theme-discovery/` — the theme field is free
 * text, and it is free text on purpose.
 *
 * It was a `<select>` over `STOREFRONT_THEME_CODES` for one release. D-199
 * removed that list from `@endora-commerce/contracts`: a theme is a token set a
 * **third party** may publish as an ordinary npm package, so no set this
 * repository can compile is the whole set, and a control offering one would be
 * offering the wrong one.
 *
 * The admin and the storefront are separate deployments, so whatever a list
 * here showed could only ever be advisory — the storefront is the only thing
 * that knows which themes it has installed, and it already answers a wrong
 * value correctly (it renders its own default, marks the document
 * `data-theme-requested`, and never writes the value back). A control that
 * refused would be refusing on worse information than the thing that decides.
 *
 * So the two claims this file makes are: **any well-formed code is accepted**,
 * including one nothing in this repository has heard of, and **a stored value
 * is never rewritten** by opening the form.
 */

// The form builds its two dictionary requests itself since feature 091's P6 —
// it no longer imports `dictionaries`' admin API client, so the seam a test can
// isolate is `apiClient`. The stub answers **by URL**, which makes the mock a
// behavioural check on the rebuilt paths: a caller that names the wrong one
// throws rather than quietly rendering an empty list.
// **Re-keyed by feature 091's Phase 4 batch 14, and this is the trap that has
// now met seven merge requests in a row.** The mock named `@/lib/api-client`
// while the subject was under `admin/src`; the subject is inside a module
// package now and resolves `@endora-commerce/admin-kit/lib`, of which
// `@/lib/api-client` is only a re-export shim — so the old spelling intercepted
// nothing and vitest reported that by making the mock **inert** rather than by
// failing. `tsc` cannot see it: both specifiers compile. A programmatic sweep
// of every mock against the file's own imports is what found it.
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

const { ChannelIdentityForm } = await import(
  '../../../../packages/modules/sales_channels/src/admin/components/ChannelIdentityForm'
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

function themeInput(): HTMLInputElement {
  const el = document.getElementById('sc-theme');
  expect(el).not.toBeNull();
  return el as HTMLInputElement;
}

describe('the sales-channel theme control', () => {
  it('is a free-text box, not a closed list', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="create" onSubmit={() => undefined} />,
      bundle,
    );
    expect(themeInput().tagName).toBe('INPUT');
  });

  it('accepts a code this repository has never heard of', () => {
    // The whole point of D-199: a theme published by a stranger and installed
    // into the operator's own storefront. Nothing here enumerates it, and the
    // field neither refuses it nor decorates it as unknown — this screen has no
    // standing to say so.
    let submitted: { themeCode: string } | null = null;
    renderWithI18n(
      <ChannelIdentityForm
        mode="create"
        onSubmit={(value) => {
          submitted = value;
        }}
      />,
      bundle,
    );
    const input = themeInput();
    fireEvent.change(input, { target: { value: '  vendor-theme-x  ' } });
    expect(input.value).toBe('  vendor-theme-x  ');
    fireEvent.submit(input.closest('form')!);
    expect(submitted).not.toBeNull();
    expect(submitted!.themeCode).toBe('vendor-theme-x');
  });

  it('holds the field to the same shape the backend validates, and no more', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="create" onSubmit={() => undefined} />,
      bundle,
    );
    // `themeCodeRe` in `packages/contracts/src/sales-channels.ts`, which the
    // write schemas still use and which this feature deliberately did not
    // tighten. The control refuses a malformed code and accepts every
    // well-formed one.
    const pattern = new RegExp(`^(?:${themeInput().getAttribute('pattern')})$`);
    for (const good of ['nordic', 'theme-x', 'a', 'a_b-9']) expect(pattern.test(good)).toBe(true);
    for (const bad of ['Nordic', '9lives', '-x', 'thème']) expect(pattern.test(bad)).toBe(false);
  });

  it('never rewrites a stored code, whatever it is', () => {
    // Opening the form must not re-point the channel at a different theme, and
    // there is now no list against which it could think one is "wrong".
    for (const stored of ['industria-pro', 'nordic', 'vendor-theme-x']) {
      const { unmount } = renderWithI18n(
        <ChannelIdentityForm mode="edit" initial={channel(stored)} onSubmit={() => undefined} />,
        bundle,
      );
      expect(themeInput().value).toBe(stored);
      unmount();
    }
  });

  it('renders an empty field for a channel that names no theme', () => {
    renderWithI18n(
      <ChannelIdentityForm mode="edit" initial={channel(null)} onSubmit={() => undefined} />,
      bundle,
    );
    expect(themeInput().value).toBe('');
  });
});

describe('the theme control ships both shipped languages', () => {
  it('has an en and a pl string for every key the control renders', () => {
    for (const key of [
      'identity.theme.label',
      'identity.theme.placeholder',
      'identity.theme.pattern',
      'identity.theme.help',
    ]) {
      expect(en[key], `missing en: ${key}`).toBeTruthy();
      expect(pl[key], `missing pl: ${key}`).toBeTruthy();
    }
  });

  it('no longer ships the keys of the closed list', () => {
    // A label per code was a second copy of a closed set. There is no set.
    for (const key of [
      'identity.theme.none',
      'identity.theme.unknown',
      'identity.theme.option.industria',
      'identity.theme.option.nordic',
    ]) {
      expect(en[key], `en still ships ${key}`).toBeUndefined();
      expect(pl[key], `pl still ships ${key}`).toBeUndefined();
    }
  });
});
