import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AdminCrawlerFilePreview, AdminZoneProps } from '@endora-commerce/contracts';
import { composeCrawlerFile } from '@endora-commerce/contracts';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `seo`'s three contributions beside its own settings on the Settings screen
 * (`specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §4):
 * the `robots.txt` preview on *Custom robots.txt instructions*, the `llms.txt`
 * preview on *Additional llms.txt content* (ruling R10), and the
 * outdated-storefront notice on *Default robots* (ruling R9).
 *
 * What is shown for which state is the pure model's subject, in the package
 * (`preview-model.test.ts`). This file holds what only a rendered tree can:
 * that the contributions are declared, matched and gated; that they vanish
 * with the module; that the one block on screen holds the served file and
 * nothing else; that typing asks the backend nothing; that one channel's
 * answer is never drawn for another; and that what a storefront sent is drawn
 * as text.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const seo = await import('@endora-commerce/mod-seo/admin');
const REGISTRY = [{ moduleId: 'seo', contributions: seo.contributions }];

const readBundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/seo/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
const EN = readBundle('en');
const PL = readBundle('pl');
const en = (key: string, params: Record<string, string> = {}): string => {
  const template = EN[key];
  if (template === undefined) throw new Error(`no such key in seo/i18n/en.json: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? `{${name}}`);
};

const BASE = 'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://shop.example/sitemap.xml\n';
const OWN = 'User-agent: GPTBot\nDisallow: /\n';
const CHANNELS_URL = '/api/v1/admin/sales-channels?activeOnly=false&pageSize=100&page=0';
const DEFAULT_PREVIEW_URL = '/api/v1/admin/seo/crawler-files/preview?file=robots';
const previewUrl = (channel: string): string =>
  `/api/v1/admin/seo/crawler-files/preview?file=robots&salesChannelCode=${channel}`;

function answer(channel: string, overrides: Partial<AdminCrawlerFilePreview> = {}): { data: AdminCrawlerFilePreview } {
  return {
    data: {
      file: 'robots',
      salesChannelCode: channel,
      state: 'ok',
      base: BASE,
      savedExtra: '',
      savedExtraSource: 'default',
      channelsWithOwnValue: [],
      policy: { index: true, follow: true },
      storefront: { url: `https://${channel}.shop.example`, source: 'setting' },
      ...overrides,
    },
  };
}

/** What the backend answers, per channel. A missing channel is a failed request. */
let answers: Record<string, { data: AdminCrawlerFilePreview } | Error>;

type ZoneProps = AdminZoneProps<'settings.setting.after'>;

function zone(
  props: Partial<ZoneProps> = {},
  options: { readonly permissions?: readonly string[]; readonly present?: readonly string[] } = {},
): ReactElement {
  return withSession(
    <AdminZone
      name="settings.setting.after"
      props={{
        settingCode: 'seo.robots_txt_custom',
        ownerModule: 'seo',
        channelCode: 'pl',
        draftText: '',
        dirty: false,
        ...props,
      }}
    />,
    {
      session: adminSession({ permissions: [...(options.permissions ?? ['settings:read'])] }),
      presence: modulePresence({ present: [...(options.present ?? ['seo', 'settings'])] }),
      contributions: REGISTRY,
    },
  );
}

const previewCalls = (): string[] =>
  getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('/crawler-files/'));

const part = (container: HTMLElement, name: string): HTMLElement | null =>
  container.querySelector(`[data-part="${name}"]`);

const notice = (container: HTMLElement, kind: string): HTMLElement | null =>
  container.querySelector(`[data-notice="${kind}"]`);

/** The channel list the backend answers; `null` refuses it, as for somebody who may not list. */
let channelList: Array<{ code: string; systemDefault: boolean }> | null;

beforeEach(() => {
  answers = { pl: answer('pl'), de: answer('de') };
  channelList = [
    { code: 'pl', systemDefault: false },
    { code: 'de', systemDefault: true },
  ];
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === CHANNELS_URL) {
      return channelList === null
        ? Promise.reject(new Error('403'))
        : Promise.resolve({ items: channelList, page: 0, pageSize: 100, total: channelList.length });
    }
    if (path === DEFAULT_PREVIEW_URL && answers['(default)'] !== undefined) {
      const response = answers['(default)'];
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }
    for (const [channel, response] of Object.entries(answers)) {
      if (path === previewUrl(channel)) {
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      }
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => cleanup());

/** The one block: the file. */
const file = (container: HTMLElement): HTMLElement | null => part(container, 'file');
const heading = (name: string): HTMLElement => screen.getByRole('heading', { name, level: 2 });

describe('seo declares its contributions beside its settings', () => {
  it('the preview: matched to the robots.txt setting, gated on settings:read, behind a dynamic import', () => {
    const zones = (seo.contributions.zones ?? []).filter((entry) => entry.zone === 'settings.setting.after');
    expect(zones).toHaveLength(3);
    const preview = zones.find((entry) => entry.match?.['settingCode'] === 'seo.robots_txt_custom');
    expect(preview?.requiredPermission).toBe('settings:read');
    expect(typeof preview?.component).toBe('function');
  });

  it('the llms.txt preview: matched to its own setting, gated on settings:read, behind a dynamic import', () => {
    const zones = seo.contributions.zones ?? [];
    const preview = zones.find((entry) => entry.match?.['settingCode'] === 'seo.llms_txt_additional');
    expect(preview?.zone).toBe('settings.setting.after');
    expect(preview?.requiredPermission).toBe('settings:read');
    expect(typeof preview?.component).toBe('function');
    // One contribution per setting: no two are drawn beside the same row.
    const codes = zones.map((entry) => entry.match?.['settingCode']);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('the notice: matched to the default robots setting, gated on settings:read', () => {
    const zones = seo.contributions.zones ?? [];
    const noticeZone = zones.find((entry) => entry.match?.['settingCode'] === 'seo.default_robots');
    expect(noticeZone?.zone).toBe('settings.setting.after');
    expect(noticeZone?.requiredPermission).toBe('settings:read');
  });

  it('every contribution is narrowed to one setting: none renders beside a setting of another module', () => {
    // Only the Settings screen's zone: the product editor's SEO link (feature 163) is not a setting row.
    const settingRows = (seo.contributions.zones ?? []).filter((entry) => entry.zone === 'settings.setting.after');
    expect(settingRows.length).toBeGreaterThan(0);
    for (const entry of settingRows) {
      expect(typeof entry.match?.['settingCode']).toBe('string');
    }
  });

  it('ships every sentence in English and in Polish', () => {
    const keys = Object.keys(EN).filter((key) => key.startsWith('crawlerPreview.'));
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(PL[key], `pl.json lacks ${key}`).toBeTruthy();
      expect(PL[key], `pl.json repeats the English for ${key}`).not.toBe(EN[key]);
    }
  });
});

describe('the robots.txt preview', () => {
  it('shows one block whose text is the served file, byte for byte', async () => {
    const { container } = renderWithI18n(zone({ draftText: OWN }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    const block = file(container) as HTMLElement;
    // The file, and nothing but the file: no label, no badge, no stray space.
    expect(block.textContent).toBe(composeCrawlerFile(BASE, OWN));
    expect(container.querySelectorAll('[data-part="file"]')).toHaveLength(1);
    // Nothing of it is drawn a second time outside the block.
    expect(part(container, 'operator-detached')).toBeNull();
    expect(previewCalls()).toEqual([previewUrl('pl')]);
  });

  it('with nothing written, the block is the generated rules alone, byte for byte', async () => {
    const { container } = renderWithI18n(zone({ draftText: '' }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(BASE);
    expect(part(container, 'operator')).toBeNull();
    expect(
      screen.getByText(`${en('crawlerPreview.legend.systemOnly')} ${en('crawlerPreview.legend.nothingAdded')}`),
    ).toBeTruthy();
  });

  it('tells the operator’s lines from the generated ones inside the block, in words', async () => {
    const { container } = renderWithI18n(zone({ draftText: OWN }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    const block = file(container) as HTMLElement;
    const system = part(container, 'system') as HTMLElement;
    const operator = part(container, 'operator') as HTMLElement;
    expect(block.contains(system)).toBe(true);
    expect(block.contains(operator)).toBe(true);
    expect(system.compareDocumentPosition(operator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(system.textContent).toBe(`${BASE.trimEnd()}\n`);
    expect(operator.textContent).toBe(OWN);
    // Each stretch carries its label — drawn by the stylesheet, so that it is
    // not text in the file — and the operator's is marked by a rule as well.
    expect(system.dataset['label']).toBe(en('crawlerPreview.system.label'));
    expect(operator.dataset['label']).toBe(en('crawlerPreview.operator.label'));
    expect(operator.className).toContain('border-l-4');
    expect(system.className).not.toContain('border-l-4');
    // The same distinction as text, for a reader who does not get the labels.
    const legend = document.getElementById(block.getAttribute('aria-describedby') as string);
    expect(legend?.textContent).toBe(en('crawlerPreview.legend.both'));
    // The generated part cannot be edited: nothing in the preview is a field.
    expect(container.querySelector('textarea, input, [contenteditable]')).toBeNull();
  });

  it('is labelled, and the block can be reached and scrolled from the keyboard', async () => {
    const { container } = renderWithI18n(zone({ draftText: OWN }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    const title = heading(en('crawlerPreview.heading.servedNow'));
    const section = title.closest('section') as HTMLElement;
    expect(screen.getByRole('region', { name: en('crawlerPreview.heading.servedNow') })).toBe(section);
    const block = file(container) as HTMLElement;
    expect(block.tabIndex).toBe(0);
    expect(block.getAttribute('aria-labelledby')).toBe(title.id);
    // Capped, with the scroll inside the block — lower on a narrow screen.
    expect(block.className).toContain('overflow-auto');
    expect(block.className).toMatch(/(^| )max-h-80( |$)/);
    expect(block.className).toContain('sm:max-h-[48rem]');
    // No sentence fell back to its key.
    expect(section.textContent).not.toContain('crawlerPreview.');
  });

  it('keeps the operator’s lines in view: a capped block is scrolled to its end, and only the block', async () => {
    const { container, rerender } = renderWithI18n(zone({ draftText: '' }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    const block = file(container) as HTMLElement;
    // jsdom lays nothing out; give the block a height to scroll through.
    Object.defineProperty(block, 'scrollHeight', { configurable: true, value: 900 });
    block.scrollTop = 0;
    const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const focused = document.activeElement;

    rerender(zone({ draftText: 'Disallow: /a/\n', dirty: true }));
    expect(block.scrollTop).toBe(900);
    // With nothing of the operator's in the file it starts from the top.
    rerender(zone({ draftText: '', dirty: false }));
    expect(block.scrollTop).toBe(0);
    expect(pageScroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(focused);
    pageScroll.mockRestore();
  });

  it('in the outdated state does not say the text adds nothing: it is shown apart', async () => {
    answers['pl'] = answer('pl', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(zone({ draftText: OWN }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(container.textContent).not.toContain(en('crawlerPreview.legend.nothingAdded'));
    expect(screen.getByText(en('crawlerPreview.legend.systemOnly'))).toBeTruthy();
  });

  it('renders in Polish from the Polish bundle', async () => {
    const { container } = renderWithI18n(zone(), { seo: PL });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(heading('robots.txt serwowany obecnie')).toBeTruthy();
  });

  it('says what the file is: served now — and, once the field differs, after saving', async () => {
    const { container, rerender } = renderWithI18n(zone({ draftText: '' }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(heading(en('crawlerPreview.heading.servedNow'))).toBeTruthy();
    expect(container.querySelector('[data-note="unsaved"]')).toBeNull();
    expect(previewCalls()).toHaveLength(1);

    for (const typed of ['D', 'Disallow', 'Disallow: /tmp/\n']) {
      rerender(zone({ draftText: typed, dirty: true }));
    }
    // The block follows the field: it is the file as it will be served.
    expect(file(container)?.textContent).toBe(composeCrawlerFile(BASE, 'Disallow: /tmp/\n'));
    expect(heading(en('crawlerPreview.heading.afterSaving'))).toBeTruthy();
    expect(part(container, 'operator')?.dataset['label']).toBe(en('crawlerPreview.operator.labelUnsaved'));
    // That the storefront still serves the previous version is a secondary
    // line, in the polite live region.
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(within(status).getByText(en('crawlerPreview.unsavedNote'))).toBeTruthy();

    // Typing asked the backend nothing.
    await new Promise((done) => setTimeout(done, 400));
    expect(previewCalls()).toHaveLength(1);
  });

  it('asks again once its own row is saved, and then calls the file served now', async () => {
    const { container, rerender } = renderWithI18n(zone({ draftText: 'x', dirty: true }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(previewCalls()).toHaveLength(1);
    rerender(zone({ draftText: 'x', dirty: false }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(heading(en('crawlerPreview.heading.servedNow'))).toBeTruthy();
    expect(container.querySelector('[data-note="unsaved"]')).toBeNull();
  });

  it('draws what a storefront sent as text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.__pwned = 1">\n<script>window.__pwned = 1</script>\nUser-agent: *\n';
    answers['pl'] = answer('pl', {
      base: hostile,
      storefront: { url: 'javascript:alert(1)//<b>x</b>', source: 'setting' },
    });
    const { container } = renderWithI18n(zone({ draftText: '<b onclick="x()">bold</b>' }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(composeCrawlerFile(hostile, '<b onclick="x()">bold</b>'));
    expect(container.querySelector('img, script, b, a')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // The address is shown, and is not something to click.
    expect(container.textContent).toContain('javascript:alert(1)//<b>x</b>');
    expect(container.querySelector('[href]')).toBeNull();
  });

  it('asks again when the channel changes, and never draws one channel’s answer for another', async () => {
    answers['pl'] = answer('pl', { base: 'User-agent: *\nDisallow: /only-pl/\n' });
    answers['de'] = answer('de', { base: 'User-agent: *\nDisallow: /only-de/\n' });
    const { container, rerender } = renderWithI18n(zone({ channelCode: 'pl' }), { seo: EN });
    await waitFor(() => expect(file(container)?.textContent).toContain('/only-pl/'));

    rerender(zone({ channelCode: 'de' }));
    // From the first frame of the new channel, the old one's rules are gone.
    expect(container.textContent).not.toContain('/only-pl/');
    await waitFor(() => expect(file(container)?.textContent).toContain('/only-de/'));
    expect(container.textContent).not.toContain('/only-pl/');
    expect(previewCalls()).toEqual([previewUrl('pl'), previewUrl('de')]);

    // And back: nothing remembered is shown while the channel is asked about again.
    answers['pl'] = answer('pl', { base: 'User-agent: *\nDisallow: /pl-now/\n' });
    rerender(zone({ channelCode: 'pl' }));
    expect(container.textContent).not.toContain('/only-pl/');
    expect(container.textContent).not.toContain('/only-de/');
    await waitFor(() => expect(file(container)?.textContent).toContain('/pl-now/'));
    expect(previewCalls()).toEqual([previewUrl('pl'), previewUrl('de'), previewUrl('pl')]);
  });

  it('does not ask about every channel passed on the way to the one that is chosen', async () => {
    const { container, rerender } = renderWithI18n(zone({ channelCode: 'pl' }), { seo: EN });
    rerender(zone({ channelCode: 'de' }));
    rerender(zone({ channelCode: 'pl' }));
    rerender(zone({ channelCode: 'de' }));
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(previewCalls()).toEqual([previewUrl('de')]);
  });

  it('shows no rules from the earlier answer while it is asking again (FR-042)', async () => {
    answers['pl'] = answer('pl', { base: 'User-agent: *\nDisallow: /earlier/\n' });
    const { container } = renderWithI18n(zone(), { seo: EN });
    await waitFor(() => expect(container.textContent).toContain('/earlier/'));

    // The next answer is held back.
    let release: (value: unknown) => void = () => {};
    getSpy.mockImplementation(() => new Promise((resolvePending) => (release = resolvePending)));
    fireEvent.click(screen.getByRole('button', { name: en('crawlerPreview.refresh') }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    expect(container.textContent).not.toContain('/earlier/');
    expect(file(container)).toBeNull();
    expect(heading(en('crawlerPreview.heading.unknown'))).toBeTruthy();
    release(answer('pl', { base: 'User-agent: *\nDisallow: /later/\n' }));
    await waitFor(() => expect(container.textContent).toContain('/later/'));
  });

  it.each([
    ['storefront-unreachable', 'storefront-unreachable', 'crawlerPreview.notice.storefrontUnreachable'],
    ['address-unknown', 'address-unknown', 'crawlerPreview.notice.addressUnknown'],
  ] as const)('%s: says so, shows no file, and still shows the operator’s text', async (state, kind, key) => {
    answers['pl'] = answer('pl', { state, base: null });
    const { container } = renderWithI18n(zone({ draftText: OWN, dirty: true }), { seo: EN });
    await waitFor(() => expect(notice(container, kind)).not.toBeNull());
    expect(notice(container, kind)?.textContent).toContain(en(key));
    // A warning says it is one in words.
    expect(notice(container, kind)?.textContent).toContain(en('crawlerPreview.notice.warningPrefix'));
    expect(file(container)).toBeNull();
    expect(container.textContent).not.toContain('Sitemap:');
    expect(heading(en('crawlerPreview.heading.unknown'))).toBeTruthy();
    const own = part(container, 'operator-detached') as HTMLElement;
    expect(own.textContent).toBe('User-agent: GPTBot\nDisallow: /');
    expect(own.tabIndex).toBe(0);
    expect(screen.getByText(en('crawlerPreview.operator.unsavedBadge'))).toBeTruthy();
  });

  it('a failed request: says so, invents no rules, keeps the operator’s text', async () => {
    answers['pl'] = new Error('500');
    const { container } = renderWithI18n(zone({ draftText: OWN }), { seo: EN });
    await waitFor(() => expect(notice(container, 'preview-failed')).not.toBeNull());
    expect(file(container)).toBeNull();
    expect(part(container, 'operator-detached')).not.toBeNull();
  });

  it('storefront-outdated: the file is the rules it serves, and the text is apart, marked as possibly not served', async () => {
    answers['pl'] = answer('pl', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(zone({ draftText: OWN, dirty: true }), { seo: EN });
    await waitFor(() => expect(notice(container, 'storefront-outdated')).not.toBeNull());
    const warning = notice(container, 'storefront-outdated') as HTMLElement;
    // It says what is known — not confirmed — rather than what is inferred.
    expect(warning.textContent).toContain('did not confirm');
    expect(warning.textContent).toContain('may need an update');
    const block = file(container) as HTMLElement;
    expect(block.textContent).toBe(BASE);
    expect(warning.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Saving would not change what that storefront serves.
    expect(heading(en('crawlerPreview.heading.servedNow'))).toBeTruthy();
    expect(part(container, 'operator-detached')?.textContent).toBe('User-agent: GPTBot\nDisallow: /');
    expect(screen.getByText(en('crawlerPreview.operator.mayNotBeServedBadge'))).toBeTruthy();
  });

  it('on a NOINDEX channel says in words that the file stays open, and cautions about Disallow: /', async () => {
    answers['pl'] = answer('pl', { policy: { index: false, follow: false } });
    const { container, rerender } = renderWithI18n(zone({ draftText: '' }), { seo: EN });
    await waitFor(() => expect(notice(container, 'stays-open')).not.toBeNull());
    expect(notice(container, 'stays-open')?.textContent).toContain(en('crawlerPreview.notice.staysOpen'));
    // The file shown is still the open one: no site-wide ban was added to it.
    expect(file(container)?.textContent).toBe(BASE);
    expect(notice(container, 'site-wide-disallow')).toBeNull();

    rerender(zone({ draftText: 'User-agent: *\nDisallow: /\n', dirty: true }));
    expect(notice(container, 'site-wide-disallow')?.textContent).toContain(
      en('crawlerPreview.notice.siteWideDisallow'),
    );
  });

  it('asks again when the operator asks it to', async () => {
    answers['pl'] = answer('pl', { state: 'storefront-unreachable', base: null });
    const { container } = renderWithI18n(zone(), { seo: EN });
    await waitFor(() => expect(notice(container, 'storefront-unreachable')).not.toBeNull());
    answers['pl'] = answer('pl');
    fireEvent.click(screen.getByRole('button', { name: en('crawlerPreview.refresh') }));
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(notice(container, 'storefront-unreachable')).toBeNull();
    expect(previewCalls()).toEqual([previewUrl('pl'), previewUrl('pl')]);
  });

  it('the all-channels value: a labelled channel picker, the default channel first, and who is not affected', async () => {
    answers['de'] = answer('de', { channelsWithOwnValue: ['pl'] });
    answers['pl'] = answer('pl', {
      savedExtra: OWN,
      savedExtraSource: 'channel',
      channelsWithOwnValue: ['pl'],
      base: 'User-agent: *\nDisallow: /only-pl/\n',
    });
    const { container } = renderWithI18n(
      zone({ channelCode: null, draftText: 'Disallow: /shared/\n', dirty: true }),
      { seo: EN },
    );
    const picker = (await screen.findByLabelText(en('crawlerPreview.channel.pickerLabel'))) as HTMLSelectElement;
    // The system default leads the list and is previewed first.
    expect([...picker.options].map((option) => option.value)).toEqual(['de', 'pl']);
    expect(picker.value).toBe('de');
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(composeCrawlerFile(BASE, 'Disallow: /shared/\n'));
    expect(heading(en('crawlerPreview.heading.afterSaving'))).toBeTruthy();
    expect(notice(container, 'channels-with-own-value')?.textContent).toContain(
      en('crawlerPreview.notice.channelsWithOwnValue', { channels: 'pl' }),
    );

    // The operator picks the channel that has its own value: it is shown the
    // file it serves, and the all-channels text is not drawn as if it reached it.
    fireEvent.change(picker, { target: { value: 'pl' } });
    expect(container.textContent).not.toContain('/only-pl/');
    await waitFor(() => expect(file(container)?.textContent).toContain('/only-pl/'));
    expect(file(container)?.textContent).toBe(composeCrawlerFile('User-agent: *\nDisallow: /only-pl/\n', OWN));
    expect(container.textContent).not.toContain('/shared/');
    expect(notice(container, 'previewed-channel-has-own-value')).not.toBeNull();
    expect(part(container, 'operator')?.dataset['label']).toBe(en('crawlerPreview.operator.labelSaved'));
    expect(heading(en('crawlerPreview.heading.servedNow'))).toBeTruthy();
  });

  it('re-asks when the page goes from all channels to a channel and back, so a value saved in between is known', async () => {
    // Under "All channels" the preview shows the default channel, `de`.
    const { container, rerender } = renderWithI18n(
      zone({ channelCode: null, draftText: 'Disallow: /shared/\n' }),
      { seo: EN },
    );
    // The storefront's answer for `de` has arrived: nothing of its own yet.
    await waitFor(() => expect(file(container)?.textContent).toContain('/shared/'));
    expect(notice(container, 'previewed-channel-has-own-value')).toBeNull();

    // The page is switched to `de`, and `de` is given a value of its own.
    rerender(zone({ channelCode: 'de', draftText: OWN, dirty: true }));
    answers['de'] = answer('de', {
      savedExtra: OWN,
      savedExtraSource: 'channel',
      channelsWithOwnValue: ['de'],
    });
    rerender(zone({ channelCode: 'de', draftText: OWN, dirty: false }));

    // Back to "All channels": `de` now serves its own text, not the shared one.
    rerender(zone({ channelCode: null, draftText: 'Disallow: /shared/\n' }));
    // Not for one frame is the earlier answer drawn as what `de` serves.
    expect(container.textContent).not.toContain('/shared/\n\n');
    expect(file(container)).toBeNull();
    await waitFor(() => expect(notice(container, 'previewed-channel-has-own-value')).not.toBeNull());
    expect(file(container)?.textContent).toBe(composeCrawlerFile(BASE, OWN));
    expect(container.textContent).not.toContain('/shared/');
  });

  it('the mirror: an own value removed in between is no longer drawn as the channel’s own', async () => {
    answers['de'] = answer('de', {
      savedExtra: OWN,
      savedExtraSource: 'channel',
      channelsWithOwnValue: ['de'],
    });
    const { container, rerender } = renderWithI18n(
      zone({ channelCode: null, draftText: 'Disallow: /shared/\n' }),
      { seo: EN },
    );
    await waitFor(() => expect(notice(container, 'previewed-channel-has-own-value')).not.toBeNull());

    // The page is switched to `de` and its own value is reset.
    rerender(zone({ channelCode: 'de', draftText: OWN }));
    answers['de'] = answer('de', { savedExtraSource: 'global', savedExtra: 'Disallow: /shared/\n' });
    rerender(zone({ channelCode: 'de', draftText: 'Disallow: /shared/\n' }));

    rerender(zone({ channelCode: null, draftText: 'Disallow: /shared/\n' }));
    await waitFor(() => expect(file(container)?.textContent).toBe(composeCrawlerFile(BASE, 'Disallow: /shared/\n')));
    expect(notice(container, 'previewed-channel-has-own-value')).toBeNull();
    expect(container.textContent).not.toContain('GPTBot');
  });

  it('for somebody who may not list sales channels, previews the system default channel and names it (FR-045)', async () => {
    channelList = null;
    answers['(default)'] = answer('main', { base: 'User-agent: *\nDisallow: /main-only/\n' });
    const { container } = renderWithI18n(zone({ channelCode: null, draftText: OWN }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(composeCrawlerFile('User-agent: *\nDisallow: /main-only/\n', OWN));
    // No picker to offer; the channel is named from the answer.
    expect(screen.queryByLabelText(en('crawlerPreview.channel.pickerLabel'))).toBeNull();
    expect(screen.getByText(en('crawlerPreview.channel.label', { channel: 'main' }))).toBeTruthy();
    expect(previewCalls()).toEqual([DEFAULT_PREVIEW_URL]);
  });

  it('reads every page of the channel list rather than the first hundred', async () => {
    const many = Array.from({ length: 130 }, (_unused, index) => ({
      code: `ch${String(index).padStart(3, '0')}`,
      systemDefault: index === 129,
    }));
    answers['ch129'] = answer('ch129');
    getSpy.mockImplementation((path: string) => {
      const page = /sales-channels\?activeOnly=false&pageSize=100&page=(\d+)$/.exec(path);
      if (page !== null) {
        const start = Number(page[1]) * 100;
        return Promise.resolve({ items: many.slice(start, start + 100), page: Number(page[1]), pageSize: 100, total: 130 });
      }
      if (path === previewUrl('ch129')) return Promise.resolve(answers['ch129']);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderWithI18n(zone({ channelCode: null }), { seo: EN });
    const picker = (await screen.findByLabelText(en('crawlerPreview.channel.pickerLabel'))) as HTMLSelectElement;
    expect(picker.options).toHaveLength(130);
    // The system default is on the second page, and still leads.
    expect(picker.value).toBe('ch129');
  });

  it('renders nothing and asks nothing beside another setting', async () => {
    const { container } = renderWithI18n(zone({ settingCode: 'shop.name', ownerModule: 'settings' }), { seo: EN });
    await new Promise((done) => setTimeout(done, 350));
    expect(container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing and asks nothing without settings:read', async () => {
    const { container } = renderWithI18n(zone({}, { permissions: ['catalog:write'] }), { seo: EN });
    await new Promise((done) => setTimeout(done, 350));
    expect(container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('is shown to an administrator who may read settings and change nothing (FR-045)', async () => {
    const { container } = renderWithI18n(zone({}, { permissions: ['settings:read'] }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
  });

  it('vanishes with the module — renders nothing and asks nothing while seo is off — and is back after', async () => {
    const off = renderWithI18n(zone({}, { present: ['settings'] }), { seo: EN });
    await new Promise((done) => setTimeout(done, 350));
    expect(off.container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
    off.unmount();

    const on = renderWithI18n(zone(), { seo: EN });
    await waitFor(() => expect(file(on.container)).not.toBeNull());
    expect(previewCalls()).toEqual([previewUrl('pl')]);
  });
});

/**
 * The preview beside *Additional llms.txt content* (FR-044). It is drawn by
 * the component the `robots.txt` preview is drawn by, so what is held above
 * about the block — its labels, its cap, its scrolling, its keyboard reach —
 * is not repeated; what is held here is that it is that component, asked
 * about the other file, and the one state only this file has.
 */
describe('the llms.txt preview', () => {
  const LLMS_BASE = '# Endora Demo\n\n## Pages\n\n- [Home](https://pl.shop.example/)\n';
  const CONTENT = '## About\n\nWe sell bolts.\n';
  const llmsUrl = (channel: string): string =>
    `/api/v1/admin/seo/crawler-files/preview?file=llms&salesChannelCode=${channel}`;
  const llmsAnswer = (
    channel: string,
    overrides: Partial<AdminCrawlerFilePreview> = {},
  ): { data: AdminCrawlerFilePreview } => answer(channel, { file: 'llms', base: LLMS_BASE, ...overrides });
  const llms = (props: Partial<ZoneProps> = {}, options: Parameters<typeof zone>[1] = {}): ReactElement =>
    zone({ settingCode: 'seo.llms_txt_additional', ...props }, options);

  /** What the backend answers about `llms.txt`, per channel. */
  let llmsAnswers: Record<string, { data: AdminCrawlerFilePreview } | Error>;

  beforeEach(() => {
    llmsAnswers = { pl: llmsAnswer('pl'), de: llmsAnswer('de') };
    const robots = getSpy.getMockImplementation() as (path: string) => Promise<unknown>;
    getSpy.mockImplementation((path: string) => {
      for (const [channel, response] of Object.entries(llmsAnswers)) {
        if (path === llmsUrl(channel)) {
          return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
        }
      }
      return robots(path);
    });
  });

  it('shows one block whose text is the served file, byte for byte, and asks about llms.txt', async () => {
    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(container.querySelectorAll('[data-part="file"]')).toHaveLength(1);
    expect(part(container, 'operator-detached')).toBeNull();
    expect(previewCalls()).toEqual([llmsUrl('pl')]);
  });

  it('looks and reads as the robots.txt preview does: the same block, its own words', async () => {
    const robots = renderWithI18n(zone({ draftText: OWN }), { seo: EN });
    await waitFor(() => expect(file(robots.container)).not.toBeNull());
    const robotsBlock = file(robots.container) as HTMLElement;
    const robotsClasses = {
      block: robotsBlock.className,
      system: part(robots.container, 'system')?.className,
      operator: part(robots.container, 'operator')?.className,
      section: robots.container.querySelector('section')?.className,
    };
    robots.unmount();

    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    const block = file(container) as HTMLElement;
    // The same capped, scrollable, focusable block and the same marking.
    expect({
      block: block.className,
      system: part(container, 'system')?.className,
      operator: part(container, 'operator')?.className,
      section: container.querySelector('section')?.className,
    }).toEqual(robotsClasses);
    expect(block.className).toContain('max-h-80');
    expect(block.className).toContain('overflow-auto');
    expect(block.getAttribute('tabindex')).toBe('0');
    // Its own words: "content", not "instructions", and the file's own name.
    expect(heading(en('crawlerPreview.llms.heading.servedNow'))).toBeTruthy();
    expect(heading('llms.txt as served now')).toBeTruthy();
    expect(part(container, 'operator')?.dataset['label']).toBe(en('crawlerPreview.llms.operator.label'));
    expect(part(container, 'system')?.dataset['label']).toBe(en('crawlerPreview.system.label'));
    const legend = document.getElementById(block.getAttribute('aria-describedby') as string);
    expect(legend?.textContent).toBe(en('crawlerPreview.llms.legend.both'));
    expect(container.textContent).not.toMatch(/instructions|robots\.txt/);
  });

  it('says what the file is: served now — and, once the field differs, after saving', async () => {
    const { container, rerender } = renderWithI18n(llms({ draftText: '' }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(LLMS_BASE);
    expect(heading('llms.txt as served now')).toBeTruthy();

    rerender(llms({ draftText: CONTENT, dirty: true }));
    expect(file(container)?.textContent).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(heading('llms.txt after saving')).toBeTruthy();
    expect(part(container, 'operator')?.dataset['label']).toBe(
      en('crawlerPreview.llms.operator.labelUnsaved'),
    );
    expect(container.querySelector('[data-note="unsaved"]')?.textContent).toBe(
      en('crawlerPreview.unsavedNote'),
    );
    // Typing asked the backend nothing.
    await new Promise((done) => setTimeout(done, 400));
    expect(previewCalls()).toEqual([llmsUrl('pl')]);
  });

  it('on a NOINDEX channel says, in words, that no llms.txt is served — in place of the block', async () => {
    llmsAnswers['pl'] = llmsAnswer('pl', {
      state: 'not-served',
      base: null,
      policy: { index: false, follow: true },
      savedExtra: CONTENT,
    });
    const { container } = renderWithI18n(llms({ draftText: CONTENT, dirty: true }), { seo: EN });
    await waitFor(() => expect(notice(container, 'llms-not-served-noindex')).not.toBeNull());
    expect(heading('llms.txt is not served')).toBeTruthy();
    const shown = notice(container, 'llms-not-served-noindex') as HTMLElement;
    expect(shown.textContent).toBe(en('crawlerPreview.llms.notice.notServedNoindex'));
    // The reason, not only the fact — and that nothing is lost.
    expect(shown.textContent).toContain('asks search engines not to index');
    expect(shown.textContent).toContain('Your content is kept');
    // An explanation, not an alarm: it is what the operator configured.
    expect(shown.textContent).not.toContain(en('crawlerPreview.notice.warningPrefix'));
    // No file, and nothing drawn that could be taken for one.
    expect(file(container)).toBeNull();
    expect(part(container, 'operator-detached')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('[data-note="unsaved"]')).toBeNull();
    // It is in the polite live region, like every other answer that arrives.
    expect(shown.closest('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('says the same when the saved setting already forbids indexing and the storefront has not caught up', async () => {
    llmsAnswers['pl'] = llmsAnswer('pl', { policy: { index: false, follow: false } });
    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(notice(container, 'llms-not-served-noindex')).not.toBeNull());
    expect(file(container)).toBeNull();
  });

  it('not served on a channel that may be indexed: says so without blaming the setting', async () => {
    llmsAnswers['pl'] = llmsAnswer('pl', { state: 'not-served', base: null });
    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(notice(container, 'llms-not-served')).not.toBeNull());
    expect(notice(container, 'llms-not-served')?.textContent).toBe(
      en('crawlerPreview.llms.notice.notServed'),
    );
    expect(notice(container, 'llms-not-served-noindex')).toBeNull();
    expect(file(container)).toBeNull();
  });

  it('comes back once the channel is indexable again and the operator checks again', async () => {
    llmsAnswers['pl'] = llmsAnswer('pl', { state: 'not-served', base: null, policy: { index: false, follow: true } });
    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(notice(container, 'llms-not-served-noindex')).not.toBeNull());
    llmsAnswers['pl'] = llmsAnswer('pl');
    fireEvent.click(screen.getByRole('button', { name: en('crawlerPreview.refresh') }));
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(file(container)?.textContent).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(notice(container, 'llms-not-served-noindex')).toBeNull();
  });

  it.each([
    ['storefront-unreachable', 'crawlerPreview.llms.notice.storefrontUnreachable'],
    ['address-unknown', 'crawlerPreview.llms.notice.addressUnknown'],
    ['storefront-outdated', 'crawlerPreview.llms.notice.storefrontOutdated'],
  ] as const)('%s: one sentence, no file, the content still shown apart', async (state, key) => {
    llmsAnswers['pl'] = llmsAnswer('pl', { state, base: null });
    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(notice(container, state)).not.toBeNull());
    expect(notice(container, state)?.textContent).toContain(en(key));
    expect(file(container)).toBeNull();
    expect(part(container, 'operator-detached')?.textContent).toBe(CONTENT.trimEnd());
    expect(heading('llms.txt preview')).toBeTruthy();
  });

  it('a failed request: says so, invents no base, keeps the operator’s content', async () => {
    llmsAnswers['pl'] = new Error('500');
    const { container } = renderWithI18n(llms({ draftText: CONTENT }), { seo: EN });
    await waitFor(() => expect(notice(container, 'preview-failed')).not.toBeNull());
    expect(notice(container, 'preview-failed')?.textContent).toContain(
      en('crawlerPreview.llms.notice.previewFailed'),
    );
    expect(file(container)).toBeNull();
  });

  it('never draws the robots.txt answer in it, nor its own in the robots.txt preview: two rows, two requests', async () => {
    const { container } = renderWithI18n(
      <>
        <div data-row="robots">{zone({ draftText: OWN })}</div>
        <div data-row="llms">{llms({ draftText: CONTENT })}</div>
      </>,
      { seo: EN },
    );
    await waitFor(() => expect(container.querySelectorAll('[data-part="file"]')).toHaveLength(2));
    const robotsRow = container.querySelector('[data-row="robots"]') as HTMLElement;
    const llmsRow = container.querySelector('[data-row="llms"]') as HTMLElement;
    expect(file(robotsRow)?.textContent).toBe(composeCrawlerFile(BASE, OWN));
    expect(file(llmsRow)?.textContent).toBe(composeCrawlerFile(LLMS_BASE, CONTENT));
    expect(previewCalls().sort()).toEqual([llmsUrl('pl'), previewUrl('pl')].sort());
  });

  it('asks again when the Default robots row is saved: whether a file exists follows from it', async () => {
    const both = (dirty: boolean): ReactElement => (
      <>
        {zone({ settingCode: 'seo.default_robots', draftText: 'NOINDEX, FOLLOW', dirty })}
        <div data-row="llms">{llms({ draftText: CONTENT })}</div>
      </>
    );
    const { container, rerender } = renderWithI18n(both(true), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    // The Default robots row is mounted once it has asked its own question: a
    // row that mounts after the save has no "was being edited" to compare with.
    await waitFor(() => expect(previewCalls()).toContain(previewUrl('pl')));
    llmsAnswers['pl'] = llmsAnswer('pl', { state: 'not-served', base: null, policy: { index: false, follow: true } });
    rerender(both(false));
    await waitFor(() => expect(notice(container, 'llms-not-served-noindex')).not.toBeNull());
    expect(file(container.querySelector('[data-row="llms"]') as HTMLElement)).toBeNull();
  });

  it('the all-channels value: the channel picker, and the channel asked about is the one chosen', async () => {
    llmsAnswers['de'] = llmsAnswer('de', { base: '# Only DE\n', channelsWithOwnValue: ['pl'] });
    const { container } = renderWithI18n(llms({ channelCode: null, draftText: CONTENT, dirty: true }), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    // The system default channel first.
    expect(previewCalls()).toEqual([llmsUrl('de')]);
    expect(file(container)?.textContent).toBe(composeCrawlerFile('# Only DE\n', CONTENT));
    expect(notice(container, 'channels-with-own-value')?.textContent).toContain('pl');
    expect(screen.getByLabelText(en('crawlerPreview.channel.pickerLabel'))).toBeTruthy();
  });

  it('renders in Polish from the Polish bundle', async () => {
    llmsAnswers['pl'] = llmsAnswer('pl', { state: 'not-served', base: null, policy: { index: false, follow: true } });
    const { container } = renderWithI18n(llms(), { seo: PL });
    await waitFor(() => expect(notice(container, 'llms-not-served-noindex')).not.toBeNull());
    expect(heading('llms.txt nie jest serwowany')).toBeTruthy();
    expect(notice(container, 'llms-not-served-noindex')?.textContent).toBe(
      PL['crawlerPreview.llms.notice.notServedNoindex'],
    );
  });

  it('renders nothing and asks nothing without settings:read', async () => {
    const { container } = renderWithI18n(llms({}, { permissions: ['catalog:write'] }), { seo: EN });
    await new Promise((done) => setTimeout(done, 350));
    expect(container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('vanishes with the module — renders nothing and asks nothing while seo is off — and is back after', async () => {
    const off = renderWithI18n(llms({}, { present: ['settings'] }), { seo: EN });
    await new Promise((done) => setTimeout(done, 350));
    expect(off.container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
    off.unmount();

    const on = renderWithI18n(llms(), { seo: EN });
    await waitFor(() => expect(file(on.container)).not.toBeNull());
    expect(previewCalls()).toEqual([llmsUrl('pl')]);
  });
});

describe('the outdated-storefront notice on the Default robots row', () => {
  const defaultRobots = (props: Partial<ZoneProps> = {}, options: Parameters<typeof zone>[1] = {}): ReactElement =>
    zone({ settingCode: 'seo.default_robots', draftText: 'NOINDEX, NOFOLLOW', ...props }, options);
  const KIND = 'default-robots-storefront-outdated';

  it('says the storefront did not confirm support and may not apply the setting', async () => {
    answers['pl'] = answer('pl', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(defaultRobots(), { seo: EN });
    await waitFor(() => expect(notice(container, KIND)).not.toBeNull());
    const shown = notice(container, KIND) as HTMLElement;
    expect(shown.textContent).toContain(en('crawlerPreview.defaultRobots.storefrontOutdated'));
    expect(shown.textContent).toContain(en('crawlerPreview.notice.warningPrefix'));
    // What is known, not what is inferred.
    expect(shown.textContent).toContain('did not confirm');
    expect(shown.textContent).toContain('may run an older version');
    expect(shown.textContent).not.toMatch(/does not apply "Default robots" yet/);
    // The notice and nothing else: no preview of a file on this row.
    expect(file(container)).toBeNull();
    expect(previewCalls()).toEqual([previewUrl('pl')]);
  });

  it('announces it: the live region is there, empty, before the notice arrives in it', async () => {
    answers['pl'] = answer('pl', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(defaultRobots(), { seo: EN });
    // Before the answer: the region exists and says nothing.
    const region = await waitFor(() => {
      const found = container.querySelector('[role="status"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(region.textContent).toBe('');
    expect(region.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(notice(container, KIND)).not.toBeNull());
    // The same element, now carrying the notice.
    expect(region.contains(notice(container, KIND))).toBe(true);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it.each([
    ['is current', answer('pl')],
    ['cannot be reached', answer('pl', { state: 'storefront-unreachable', base: null })],
    ['has no address', answer('pl', { state: 'address-unknown', base: null })],
    ['could not be asked about', new Error('500')],
  ])('adds nothing to the row when the storefront %s', async (_label, response) => {
    answers['pl'] = response;
    const { container } = renderWithI18n(defaultRobots(), { seo: EN });
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    await new Promise((done) => setTimeout(done, 50));
    expect(container.textContent).toBe('');
  });

  it('edited for all channels, names the channels whose storefront is outdated', async () => {
    answers['de'] = answer('de', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(defaultRobots({ channelCode: null }), { seo: EN });
    await waitFor(() => expect(notice(container, KIND)).not.toBeNull());
    expect(notice(container, KIND)?.textContent).toContain(
      en('crawlerPreview.defaultRobots.storefrontOutdatedChannels', { channels: 'de' }),
    );
    expect(previewCalls().sort()).toEqual([previewUrl('de'), previewUrl('pl')]);
  });

  it('for somebody who may not list sales channels, asks about the system default one', async () => {
    channelList = null;
    answers['(default)'] = answer('main', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(defaultRobots({ channelCode: null }), { seo: EN });
    await waitFor(() => expect(notice(container, KIND)).not.toBeNull());
    expect(notice(container, KIND)?.textContent).toContain('main');
    expect(previewCalls()).toEqual([DEFAULT_PREVIEW_URL]);
  });

  it('shares one request with the preview on the other row', async () => {
    const { container } = renderWithI18n(
      <>
        {zone()}
        {defaultRobots()}
      </>,
      { seo: EN },
    );
    await waitFor(() => expect(file(container)).not.toBeNull());
    await new Promise((done) => setTimeout(done, 50));
    expect(previewCalls()).toEqual([previewUrl('pl')]);
  });

  it('asks again once the row is saved, so the preview follows the new policy', async () => {
    const { container, rerender } = renderWithI18n(defaultRobots({ dirty: true }), { seo: EN });
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    rerender(defaultRobots({ dirty: false }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    expect(container.textContent).toBe('');
  });

  it('two rows saved together are one round of requests, not two', async () => {
    const both = (dirty: boolean): ReactElement => (
      <>
        {zone({ draftText: 'x', dirty })}
        {defaultRobots({ dirty })}
      </>
    );
    const { container, rerender } = renderWithI18n(both(true), { seo: EN });
    await waitFor(() => expect(file(container)).not.toBeNull());
    expect(previewCalls()).toHaveLength(1);
    rerender(both(false));
    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    await new Promise((done) => setTimeout(done, 100));
    expect(previewCalls()).toHaveLength(2);
  });

  it('vanishes with the module', async () => {
    answers['pl'] = answer('pl', { state: 'storefront-outdated' });
    const { container } = renderWithI18n(defaultRobots({}, { present: ['settings'] }), { seo: EN });
    await new Promise((done) => setTimeout(done, 350));
    expect(container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });
});
