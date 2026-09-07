import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import { ContentLanguageTabs, ScopePicker } from '@endora-commerce/admin-kit/components';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 091, P8 — `ContentLanguageTabs` and `ScopePicker` are the kit's.
 *
 * Two things are asserted, and neither is what a props test would say.
 *
 * **The copy is `core`'s** (R-1, `admin-kit-surface.md` R6). Both components
 * read `useTranslation('cms')` until this merge request, over six keys `cms`'
 * bundle owned. Nothing about a namespace that does not carry a key is loud:
 * `resolver.ts` returns `` `${scope}.${key}` ``, so a component pointed at the
 * wrong namespace renders `core.scopePicker.title` into the operator's screen
 * and every existing test stays green, because those tests supply a
 * *passthrough* bundle in which the key and its value are the same string. So
 * the bundle here is `_i18n`'s **shipped** one, read off disk, and the
 * assertions name the English and Polish sentences.
 *
 * **The request is the kit's own** (P2's client exit). `ScopePicker` called
 * `sales_channels`' admin API client — the one entry
 * `cross-module-imports/cms.ts` held — and now builds both `GET`s from the
 * published `apiClient`. `apiClient` is stubbed at the **kit's `lib` barrel**,
 * which is the spelling the component resolves and the only one a test can
 * name, and the paths are asserted, because an exit that fetched from the wrong
 * endpoint would render an empty list and look like an empty catalogue.
 */

const REPO_ROOT = resolve(process.cwd(), '..');

function coreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(
    join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`),
    'utf8',
  );
  return { core: JSON.parse(raw) as Record<string, string> };
}

const EN = coreBundle('en');
const PL = coreBundle('pl');

function renderInCore(ui: ReactElement, language: 'en' | 'pl'): ReturnType<typeof render> {
  const bundle = language === 'en' ? EN : PL;
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper });
}

/** Every unresolved key renders as `core.<key>`; nothing else in the admin does. */
function expectNoRawKeys(container: HTMLElement): void {
  expect(container.innerHTML).not.toMatch(/\bcore\.[a-zA-Z]/);
}

describe('ContentLanguageTabs — the kit renders it from the shipped `core` bundle', () => {
  it('says so in English and in Polish when there is no language to offer', () => {
    const en = renderInCore(
      <ContentLanguageTabs languages={[]} activeLanguage={null} onChange={(): void => {}} />,
      'en',
    );
    expect(screen.getByText('No content languages selected.')).toBeTruthy();
    expectNoRawKeys(en.container);
    en.unmount();

    const pl = renderInCore(
      <ContentLanguageTabs languages={[]} activeLanguage={null} onChange={(): void => {}} />,
      'pl',
    );
    expect(screen.getByText('Nie wybrano języków treści.')).toBeTruthy();
    expectNoRawKeys(pl.container);
    pl.unmount();
  });

  it('labels the strip and marks the active tab', () => {
    const en = renderInCore(
      <ContentLanguageTabs
        languages={['en-US', 'pl-PL']}
        activeLanguage={'pl-PL'}
        onChange={(): void => {}}
      />,
      'en',
    );
    expect(screen.getByRole('tablist', { name: 'Content language' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'pl-PL' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'en-US' }).getAttribute('aria-selected')).toBe('false');
    expectNoRawKeys(en.container);
    en.unmount();
  });
});

describe('ScopePicker — the kit builds its own sales-channel requests', () => {
  const paths: string[] = [];

  beforeEach(() => {
    paths.length = 0;
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      paths.push(path);
      if (path.startsWith('/api/v1/admin/sales-channels?')) {
        return Promise.resolve({
          items: [
            {
              id: 'channel-1',
              code: 'web',
              name: { 'en-US': 'Web store' },
              active: true,
              defaultLanguage: 'en-US',
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
        } as never);
      }
      return Promise.resolve({
        id: 'channel-1',
        code: 'web',
        name: { 'en-US': 'Web store' },
        active: true,
        defaultLanguage: 'en-US',
        languages: ['en-US', 'pl-PL'],
      } as never);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists active channels off the published endpoint and renders `core` copy', async () => {
    const en = renderInCore(
      <ScopePicker
        value={{ salesChannelIds: [], languages: [] }}
        onChange={(): void => {}}
      />,
      'en',
    );

    await waitFor(() => expect(screen.getByText('Web store')).toBeTruthy());
    expect(paths).toEqual(['/api/v1/admin/sales-channels?activeOnly=true&pageSize=100']);
    expect(screen.getByText('Scope')).toBeTruthy();
    expect(screen.getByText('Languages')).toBeTruthy();
    expect(screen.getByText('Select at least one channel.')).toBeTruthy();
    expectNoRawKeys(en.container);
    en.unmount();
  });

  it('reads the selected channel by code for its languages, and speaks Polish', async () => {
    const pl = renderInCore(
      <ScopePicker
        value={{ salesChannelIds: ['channel-1'], languages: ['en-US'] }}
        onChange={(): void => {}}
      />,
      'pl',
    );

    await waitFor(() => expect(paths).toContain('/api/v1/admin/sales-channels/web'));
    await waitFor(() => expect(screen.getByText('pl-PL')).toBeTruthy());
    expect(screen.getByText('Zakres')).toBeTruthy();
    expect(screen.getByText('Języki')).toBeTruthy();
    expectNoRawKeys(pl.container);
    pl.unmount();
  });
});
