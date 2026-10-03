import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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

/**
 * A stored scope must survive the window in which the channel's languages are
 * still in flight (found 2026-10-03 while proving PR #63 in a browser).
 *
 * The picker used to answer "which languages does this channel offer?" with
 * the channel's `defaultLanguage` until the per-channel read resolved, and a
 * pruning effect wrote that answer back through `onChange`. A page whose only
 * language was not the channel default therefore opened with nothing checked
 * and an empty canvas, and a page holding the default **and** another language
 * lost the other one silently — so the next save stored the shorter list. The
 * harness below holds the value in state the way every consumer does, so a
 * write-back is visible both as an `onChange` call and as what is rendered.
 */
describe('ScopePicker — a stored scope survives channel details loading late', () => {
  const CHANNEL = {
    id: 'channel-1',
    code: 'web',
    name: { 'en-US': 'Web store' },
    active: true,
    defaultLanguage: 'en-US',
  };

  let resolveDetail: (value: unknown) => void = () => {};
  let rejectDetail: (reason: unknown) => void = () => {};
  let detailRequests = 0;

  /** The per-channel read is in flight, so settling it now reaches this render. */
  async function detailRequested(): Promise<void> {
    await waitFor(() => expect(detailRequests).toBeGreaterThan(0));
  }

  beforeEach(() => {
    detailRequests = 0;
    vi.spyOn(apiClient, 'get').mockImplementation((path: string) => {
      if (path.startsWith('/api/v1/admin/sales-channels?')) {
        return Promise.resolve({ items: [CHANNEL], page: 1, pageSize: 100, total: 1 } as never);
      }
      detailRequests += 1;
      return new Promise((resolvePromise, rejectPromise) => {
        resolveDetail = resolvePromise;
        rejectDetail = rejectPromise;
      }) as never;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function Harness({
    initial,
    onChange,
  }: {
    initial: { salesChannelIds: string[]; languages: string[] };
    onChange: (value: { salesChannelIds: string[]; languages: string[] }) => void;
  }): ReactElement {
    const [value, setValue] = useState(initial);
    return (
      <>
        <ScopePicker
          value={value}
          onChange={(next): void => {
            onChange(next);
            setValue(next);
          }}
        />
        <output data-testid="stored-languages">{value.languages.join(',')}</output>
      </>
    );
  }

  function languageBox(language: string): HTMLInputElement {
    return screen.getByRole('checkbox', { name: language }) as HTMLInputElement;
  }

  it('keeps a non-default language and shows loading, not an empty selection, meanwhile', async () => {
    const onChange = vi.fn();
    renderInCore(
      <Harness initial={{ salesChannelIds: ['channel-1'], languages: ['pl-PL'] }} onChange={onChange} />,
      'en',
    );

    await waitFor(() => expect(screen.getByText('Web store')).toBeTruthy());
    await detailRequested();
    await waitFor(() => expect(screen.getByText('Loading channel languages…')).toBeTruthy());
    // While the channel's languages are unknown nothing is offered as unchecked.
    expect(screen.queryByRole('checkbox', { name: 'en-US' })).toBeNull();
    expect(screen.getByTestId('stored-languages').textContent).toBe('pl-PL');
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveDetail({ ...CHANNEL, languages: ['en-US', 'pl-PL'] });
    });

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'pl-PL' })).toBeTruthy());
    expect(languageBox('pl-PL').checked).toBe(true);
    expect(languageBox('en-US').checked).toBe(false);
    expect(screen.queryByText('Loading channel languages…')).toBeNull();
    expect(screen.getByTestId('stored-languages').textContent).toBe('pl-PL');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps every language of a multi-language scope, so a save cannot shorten it', async () => {
    const onChange = vi.fn();
    renderInCore(
      <Harness
        initial={{ salesChannelIds: ['channel-1'], languages: ['en-US', 'pl-PL'] }}
        onChange={onChange}
      />,
      'en',
    );

    await waitFor(() => expect(screen.getByText('Web store')).toBeTruthy());
    await detailRequested();
    expect(screen.getByTestId('stored-languages').textContent).toBe('en-US,pl-PL');

    await act(async () => {
      resolveDetail({ ...CHANNEL, languages: ['en-US', 'pl-PL'] });
    });

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'pl-PL' })).toBeTruthy());
    expect(languageBox('en-US').checked).toBe(true);
    expect(languageBox('pl-PL').checked).toBe(true);
    expect(screen.getByTestId('stored-languages').textContent).toBe('en-US,pl-PL');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a stored language the channel no longer offers, checked, instead of dropping it', async () => {
    const onChange = vi.fn();
    renderInCore(
      <Harness initial={{ salesChannelIds: ['channel-1'], languages: ['de-DE'] }} onChange={onChange} />,
      'en',
    );

    await waitFor(() => expect(screen.getByText('Web store')).toBeTruthy());
    await detailRequested();
    await act(async () => {
      resolveDetail({ ...CHANNEL, languages: ['en-US', 'pl-PL'] });
    });

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'de-DE' })).toBeTruthy());
    expect(languageBox('de-DE').checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    // The operator can still take it out themselves.
    await act(async () => {
      fireEvent.click(languageBox('de-DE'));
    });
    expect(onChange).toHaveBeenLastCalledWith({ salesChannelIds: ['channel-1'], languages: [] });
  });

  it('does not rewrite the scope when the channel read fails', async () => {
    const onChange = vi.fn();
    renderInCore(
      <Harness initial={{ salesChannelIds: ['channel-1'], languages: ['pl-PL'] }} onChange={onChange} />,
      'en',
    );

    await waitFor(() => expect(screen.getByText('Web store')).toBeTruthy());
    await detailRequested();
    await act(async () => {
      rejectDetail(new Error('channel read failed'));
    });

    await waitFor(() => expect(screen.getByText('channel read failed')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'pl-PL' })).toBeTruthy());
    expect(languageBox('pl-PL').checked).toBe(true);
    expect(screen.getByTestId('stored-languages').textContent).toBe('pl-PL');
    expect(onChange).not.toHaveBeenCalled();
  });
});
