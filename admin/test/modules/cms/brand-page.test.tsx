import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  DEFAULT_BRAND_TOKENS,
  assessBrandContrast,
  type CmsBrandTokens,
  type CmsBrandTokensAdminRead,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { BrandPage } from '../../../../packages/modules/cms/src/admin/pages/BrandPage';

/**
 * Feature 163, T028 — the brand screen (`specs/163-page-builder-marketing-pages/`
 * FR-006 to FR-006c, spec Assumptions "Channel brand overrides", contract §1).
 *
 * The screen reads `GET /api/v1/admin/cms/brand-tokens[?salesChannelId=]` and
 * writes `PUT` with `{scope, tokens | null, expectedVersion}`; both are stubbed
 * at `apiClient`, the seam every packaged screen's test drives. The session and
 * presence providers are the real ones, so the permission gate under test is
 * the `hasPermission` the shell runs. Copy is the shipped English bundle, so a
 * missing key fails here by name.
 */

function bundleOf(pkg: string, language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const en = bundleOf('cms', 'en');
const coreEn = bundleOf('_i18n', 'en');

/** The shipped English copy for `key`, with `{param}` substituted. */
function copy(key: string, params: Record<string, string> = {}): string {
  const value = en[key];
  if (!value) throw new Error(`cms/i18n/en.json carries no "${key}"`);
  return value.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}

const CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const channel = {
  id: CHANNEL_ID,
  code: 'web',
  name: { 'en-US': 'Web store' },
  active: true,
  defaultLanguage: 'en-US',
};

function withPrimary(primary: string): CmsBrandTokens {
  return structuredClone({ ...DEFAULT_BRAND_TOKENS, colors: { ...DEFAULT_BRAND_TOKENS.colors, primary } });
}

const GLOBAL = withPrimary('#1d4ed8');
const OVERRIDE = withPrimary('#0f766e');

/** What the channel scope answers in the current case. */
let channelState: { tokens: CmsBrandTokens | null; version: number } = { tokens: null, version: 0 };

function adminRead(salesChannelId: string | null): CmsBrandTokensAdminRead {
  const global = { tokens: GLOBAL, version: 3 };
  if (salesChannelId === null) {
    return { global, effective: GLOBAL, warnings: assessBrandContrast(GLOBAL) };
  }
  const effective = channelState.tokens ?? GLOBAL;
  return {
    global,
    channel: { salesChannelId, ...channelState },
    effective,
    warnings: assessBrandContrast(effective),
  };
}

const BRAND_PATH = '/api/v1/admin/cms/brand-tokens';

function brandReads(): string[] {
  return vi
    .mocked(apiClient.get)
    .mock.calls.map(([path]) => String(path))
    .filter((path) => path.startsWith(BRAND_PATH));
}

beforeEach(() => {
  channelState = { tokens: null, version: 0 };
  vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels?')) {
      return Promise.resolve({ items: [channel], page: 1, pageSize: 200, total: 1 } as never);
    }
    if (path === BRAND_PATH) return Promise.resolve({ data: adminRead(null) } as never);
    if (path === `${BRAND_PATH}?salesChannelId=${CHANNEL_ID}`) {
      return Promise.resolve({ data: adminRead(CHANNEL_ID) } as never);
    }
    if (path.startsWith('/api/v1/admin/assets')) {
      return Promise.resolve({ data: [], nextCursor: null } as never);
    }
    return Promise.reject(new Error(`unstubbed read: ${path}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(permissions: readonly string[] = ['cms.read', 'cms.brand']): void {
  renderWithI18n(
    <StrictMode>
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        {withSession(
          <MemoryRouter initialEntries={['/cms/brand']}>
            <BrandPage />
          </MemoryRouter>,
          { session: adminSession({ permissions }), presence: modulePresence({ present: ['cms'] }) },
        )}
      </AppLanguageContext.Provider>
    </StrictMode>,
    { cms: en, core: coreEn },
  );
}

/** The swatch trigger of a colour field, by its label. */
function colorTrigger(label: string): HTMLButtonElement {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

async function loaded(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: copy('brand.title') });
  await waitFor(() => expect(colorTrigger(copy('brand.colors.primary')).textContent).toContain('#1d4ed8'));
}

async function chooseChannel(): Promise<void> {
  const picker = screen.getByRole('combobox', { name: copy('brand.scope.channelLabel') });
  fireEvent.click(picker);
  fireEvent.click(await screen.findByRole('option', { name: /Web store/ }));
  await waitFor(() => expect(brandReads()).toContain(`${BRAND_PATH}?salesChannelId=${CHANNEL_ID}`));
}

function setColor(label: string, hex: string): void {
  fireEvent.click(colorTrigger(label));
  fireEvent.change(screen.getByLabelText(copy('brand.customColor', { name: label })), {
    target: { value: hex },
  });
}

function previewStyle(): string {
  const region = screen.getByRole('region', { name: copy('brand.preview.title') });
  const host = region.querySelector('[data-brand-preview]');
  expect(host, 'the preview host').not.toBeNull();
  return host!.shadowRoot?.querySelector('style')?.textContent ?? '';
}

describe('BrandPage', () => {
  it('loads the global tokens', async () => {
    mount();
    await loaded();

    expect(brandReads()[0]).toBe(BRAND_PATH);
    expect(screen.getByText(copy('brand.scope.globalHint'))).toBeTruthy();
    expect(colorTrigger(copy('brand.colors.primary')).disabled).toBe(false);
    expect(screen.getByRole('button', { name: copy('common.save') })).toBeTruthy();
  });

  it('switches to a channel that inherits the global set, and overrides it from a copy of the global set', async () => {
    mount();
    await loaded();
    await chooseChannel();

    expect(await screen.findByText(copy('brand.scope.inherits'))).toBeTruthy();
    // Inheriting: the global values are shown and cannot be edited in place.
    expect(colorTrigger(copy('brand.colors.primary')).textContent).toContain('#1d4ed8');
    expect(colorTrigger(copy('brand.colors.primary')).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: copy('brand.scope.reset') })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: copy('brand.scope.override') }));

    // The override starts as a copy of the global set, editable, with the way back.
    expect(colorTrigger(copy('brand.colors.primary')).disabled).toBe(false);
    expect(colorTrigger(copy('brand.colors.primary')).textContent).toContain('#1d4ed8');
    expect(screen.getByRole('button', { name: copy('brand.scope.reset') })).toBeTruthy();

    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 1, warnings: [] } } as never);
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toBe(BRAND_PATH);
    expect(put.mock.calls[0]![1]).toEqual({
      scope: { kind: 'channel', salesChannelId: CHANNEL_ID },
      tokens: GLOBAL,
      expectedVersion: 0,
    });
  });

  it('says an overridden channel no longer follows the global set, and resets it to global', async () => {
    channelState = { tokens: OVERRIDE, version: 2 };
    mount();
    await loaded();
    await chooseChannel();

    expect(await screen.findByText(copy('brand.scope.overriddenNotice'))).toBeTruthy();
    await waitFor(() => expect(colorTrigger(copy('brand.colors.primary')).textContent).toContain('#0f766e'));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 0, warnings: [] } } as never);
    fireEvent.click(screen.getByRole('button', { name: copy('brand.scope.reset') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![1]).toEqual({
      scope: { kind: 'channel', salesChannelId: CHANNEL_ID },
      tokens: null,
      expectedVersion: 2,
    });
  });

  it('shows a live sample of the primary colour in the light, muted and dark schemes', async () => {
    mount();
    await loaded();

    const region = screen.getByRole('region', { name: copy('brand.preview.title') });
    const shadow = region.querySelector('[data-brand-preview]')?.shadowRoot;
    expect(shadow, 'the preview renders in an isolated (shadow) root').toBeTruthy();
    const schemes = Array.from(shadow!.querySelectorAll('[data-cmsb-scheme]')).map((node) =>
      node.getAttribute('data-cmsb-scheme'),
    );
    expect(schemes).toEqual(['light', 'muted', 'dark']);
    expect(previewStyle()).toContain('--cmsb-color-primary:#1d4ed8;');
    // Scoped to the preview: nothing is written into the admin's own document.
    expect(previewStyle()).not.toContain(':root');
    expect(document.head.querySelector('style#cmsb')).toBeNull();

    setColor(copy('brand.colors.primary'), '#b91c1c');
    await waitFor(() => expect(previewStyle()).toContain('--cmsb-color-primary:#b91c1c;'));
  });

  it('warns about a low-contrast pair by name and keeps Save enabled', async () => {
    expect(assessBrandContrast(GLOBAL)).toEqual([]);
    mount();
    await loaded();
    expect(screen.queryByText(copy('brand.contrast.title'))).toBeNull();

    setColor(copy('brand.colors.primary'), '#ffff00');

    const title = await screen.findByText(copy('brand.contrast.title'));
    const alert = title.closest('[role="alert"]') as HTMLElement;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain(copy('brand.colors.onPrimary'));
    expect(alert.textContent).toContain(copy('brand.colors.primary'));
    expect((screen.getByRole('button', { name: copy('common.save') }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens the asset picker filtered to font files for a font of kind asset', async () => {
    mount();
    await loaded();

    const heading = screen.getByRole('group', { name: copy('brand.fonts.heading') });
    fireEvent.change(within(heading).getByLabelText(copy('brand.fonts.kind')), { target: { value: 'asset' } });
    fireEvent.click(await within(heading).findByRole('button', { name: 'Choose' }));

    await waitFor(() =>
      expect(
        vi
          .mocked(apiClient.get)
          .mock.calls.map(([path]) => String(path))
          .some((path) => path.startsWith('/api/v1/admin/assets?') && path.includes('mime=font%2F')),
      ).toBe(true),
    );
  });

  // T154: the dark scheme's backdrop may be a URL as well as a library asset.
  it('saves the dark scheme\'s decorative backdrop given as a URL, and removes it when the field is cleared', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 4, warnings: [] } } as never);
    mount();
    await loaded();

    const input = screen.getByLabelText(copy('brand.schemeField.decorativeUrl')) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByText(copy('brand.schemeField.decorativeUrlHint'))).toBeTruthy();
    fireEvent.change(input, { target: { value: ' https://cdn.example.com/backdrop.svg ' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const saved = (put.mock.calls[0]![1] as { tokens: CmsBrandTokens }).tokens;
    expect(saved.schemes.dark.decorativeUrl).toBe('https://cdn.example.com/backdrop.svg');
    expect(saved.schemes.light).not.toHaveProperty('decorativeUrl');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect((put.mock.calls[1]![1] as { tokens: CmsBrandTokens }).tokens.schemes.dark).not.toHaveProperty('decorativeUrl');
  });

  // R20F (T322): the tablet and small-desktop scale factors; empty is 1 (nothing stored).
  it('saves a tablet and a small-desktop scale factor, and removes one when its field is cleared', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 4, warnings: [] } } as never);
    mount();
    await loaded();

    const tablet = screen.getByLabelText(copy('brand.layout.tabletScale')) as HTMLInputElement;
    const small = screen.getByLabelText(copy('brand.layout.smallDesktopScale')) as HTMLInputElement;
    expect(tablet.value).toBe('');
    expect(screen.getByText(copy('brand.layout.scaleHint'))).toBeTruthy();
    fireEvent.change(tablet, { target: { value: '1.15' } });
    fireEvent.change(small, { target: { value: '0.9' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect((put.mock.calls[0]![1] as { tokens: CmsBrandTokens }).tokens.tierScale).toEqual({ tablet: 1.15, smallDesktop: 0.9 });

    // The save reloads the stored set (here without factors): the fields follow it.
    await waitFor(() => expect(tablet.value).toBe(''));
    fireEvent.change(tablet, { target: { value: '1.2' } });
    fireEvent.change(small, { target: { value: '0.9' } });
    fireEvent.change(tablet, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect((put.mock.calls[1]![1] as { tokens: CmsBrandTokens }).tokens.tierScale).toEqual({ smallDesktop: 0.9 });
  });

  // R21H (T351, T352): fluid desktop sizes and scaled buttons; empty stores nothing. R23 (T432): no small-desktop end, no frame per tier.
  it('saves fluid desktop and button scaling, and offers no small-desktop end or frame per tier', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { version: 4, warnings: [] } } as never);
    mount();
    await loaded();

    // By id, with the label checked once per field: label queries over the whole screen are slow here.
    const field = (id: string, key: string): HTMLInputElement => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      expect(input, id).not.toBeNull();
      const label = input!.type === 'checkbox' ? input!.closest('label') : document.querySelector(`label[for="${id}"]`);
      expect(label?.textContent?.trim(), id).toBe(copy(key));
      return input!;
    };
    const fluid = field('brand-tier-scale-fluidDesktop', 'brand.layout.fluidDesktop');
    for (const gone of ['brand-tier-scale-smallDesktopUntilPx', 'brand-layout-gutterTabletPx', 'brand-layout-gutterSmallDesktopPx', 'brand-layout-containerSmallDesktopPx']) {
      expect(document.getElementById(gone), gone).toBeNull();
    }
    expect(fluid.checked).toBe(false);
    expect(document.getElementById('brand-tier-scale-fluidUntilPx')).toBeNull();
    fireEvent.change(field('brand-tier-scale-smallDesktop', 'brand.layout.smallDesktopScale'), { target: { value: '0.9' } });
    fireEvent.click(fluid);
    fireEvent.change(field('brand-tier-scale-fluidUntilPx', 'brand.layout.fluidUntilPx'), { target: { value: '1440' } });
    fireEvent.click(field('brand-tier-scale-buttons', 'brand.layout.scaleButtons'));
    const save = screen.getByRole('button', { name: copy('common.save') });
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const tokens = (put.mock.calls[0]![1] as { tokens: CmsBrandTokens }).tokens;
    expect(tokens.tierScale).toEqual({ smallDesktop: 0.9, fluidDesktop: true, fluidUntilPx: 1440, buttons: true });

    // The stored set comes back without them: cleared fields and switches store nothing,
    // and the fluid end, which applies only with the fluid sizes on, is gone.
    await waitFor(() => expect((document.getElementById('brand-tier-scale-smallDesktop') as HTMLInputElement).value).toBe(''));
    expect(document.getElementById('brand-tier-scale-fluidUntilPx')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    const again = (put.mock.calls[1]![1] as { tokens: CmsBrandTokens }).tokens;
    expect(again).not.toHaveProperty('tierScale');
  });

  it('refuses to save a backdrop URL that is not https: or site-relative, naming the field', async () => {
    const put = vi.spyOn(apiClient, 'put');
    mount();
    await loaded();

    fireEvent.change(screen.getByLabelText(copy('brand.schemeField.decorativeUrl')), {
      target: { value: 'http://cdn.example.com/backdrop.svg' },
    });
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));
    expect(await screen.findByText(copy('brand.errors.invalid', { fields: 'schemes.dark.decorativeUrl' }))).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('is read-only without cms.brand: no Save, no override, disabled fields', async () => {
    mount(['cms.read']);
    await loaded();

    expect(screen.getByText(copy('brand.readOnly'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy('common.save') })).toBeNull();
    expect(colorTrigger(copy('brand.colors.primary')).disabled).toBe(true);
    expect((screen.getByLabelText(copy('brand.layout.containerMaxPx')) as HTMLInputElement).disabled).toBe(true);

    await chooseChannel();
    await screen.findByText(copy('brand.scope.inherits'));
    expect(screen.queryByRole('button', { name: copy('brand.scope.override') })).toBeNull();
  });

  it('shows the conflict message on 409 and reloads the stored set', async () => {
    mount();
    await loaded();
    const readsBefore = brandReads().length;

    vi.spyOn(apiClient, 'put').mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'Version conflict' } }),
    );
    setColor(copy('brand.colors.primary'), '#b91c1c');
    fireEvent.click(screen.getByRole('button', { name: copy('common.save') }));

    expect(await screen.findByText(copy('brand.errors.conflict'))).toBeTruthy();
    await waitFor(() => expect(brandReads().length).toBeGreaterThan(readsBefore));
    // The reload replaces the unsaved edit with what is stored.
    await waitFor(() => expect(colorTrigger(copy('brand.colors.primary')).textContent).toContain('#1d4ed8'));
  });
});
