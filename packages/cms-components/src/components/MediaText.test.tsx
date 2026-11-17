// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T045, US3, FR-013,
 * contracts/blocks.md `cms.MediaText` — media beside text: the media side on
 * desktop and the stacking order on mobile, a heading, rich text, an icon-item
 * list, buttons, a footnote, the vertical alignment, and repeated rows that
 * alternate their sides.
 *
 * Rendered through Puck's `<Render>`, the storefront's path.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.MediaText']?.defaultProps ?? {}) as Record<string, unknown>;

const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');

const VIDEO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const POSTER = '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f';
const MOBILE_VIDEO = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function block(props: Record<string, unknown> = {}): Data['content'][number] {
  return { type: 'cms.MediaText', props: { ...defaults, id: 'media-text-1', ...props } } as Data['content'][number];
}

function dom(content: Data['content']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

function rows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.cmsc-pb-media-text__row'));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cms.MediaText (T045)', () => {
  it('default props render a non-empty block: a heading, a sample paragraph and a media frame that reserves its space', () => {
    const host = dom([block()]);
    const root = host.querySelector('.cmsc-pb-media-text');
    expect(root).not.toBeNull();
    const heading = host.querySelector('h2');
    expect(heading?.textContent).toBeTruthy();
    // Neutral section heading: h2 at the h3 size (plan § Extend, don't narrow, rule 3).
    expect(heading!.classList).toContain('cmsc-t--h3');
    expect(host.querySelector('.cmsc-pb-media-text__body')?.textContent?.trim()).toBeTruthy();
    const media = host.querySelector('.cmsc-pb-media-text__media');
    expect(media).not.toBeNull();
    // No image chosen yet: a placeholder frame with a ratio, so nothing shifts when the image arrives.
    expect(media!.querySelector('.cmsc-pb-media-text__placeholder, .cmsc-picture--ratio')).not.toBeNull();
    expect(defaults['mediaSide']).toBe('start');
    expect(defaults['mobileOrder']).toBe('media-first');
    expect(defaults['split']).toBe('5-5');
    expect(defaults['verticalAlign']).toBe('center');
    expect(defaults['alternate']).toBe(true);
    expect(defaults['divider']).toBe(false);
  });

  it('mediaSide "end" puts the media after the text on desktop (data-media-side, ordered by the stylesheet)', () => {
    const host = dom([block({ mediaSide: 'end' })]);
    const [row] = rows(host);
    expect(row!.getAttribute('data-media-side')).toBe('end');
    // The order is CSS, from the tablet tier up: the text is the first column.
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{[^@]*\.cmsc-pb-media-text__row\[data-media-side='end'\] > \.cmsc-pb-media-text__media \{ order: 2;/,
    );
    expect(dom([block()]).querySelector('.cmsc-pb-media-text__row')!.getAttribute('data-media-side')).toBe('start');
  });

  it('mobileOrder "text-first" sets data-mobile-order, which the stylesheet reads below the tablet tier', () => {
    const host = dom([block({ mobileOrder: 'text-first' })]);
    expect(rows(host)[0]!.getAttribute('data-mobile-order')).toBe('text-first');
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    expect(css).toMatch(
      /@media \(max-width: 767\.98px\) \{[^@]*\.cmsc-pb-media-text__row\[data-mobile-order='text-first'\] > \.cmsc-pb-media-text__media \{ order: 2;/,
    );
  });

  it('the split and the vertical alignment are attributes of each row', () => {
    const host = dom([block({ split: '4-7', verticalAlign: 'end' })]);
    const [row] = rows(host);
    expect(row!.getAttribute('data-split')).toBe('4-7');
    expect(row!.getAttribute('data-valign')).toBe('end');
  });

  it('rows with alternate flip the side per row; without it every row keeps mediaSide', () => {
    const extra = [
      { heading: doc('Second'), body: doc('Second body'), media: { kind: 'image', image: { imageSource: 'url', src: '/media/two.jpg', alt: 'Two' } } },
      { heading: doc('Third'), body: doc('Third body'), media: { kind: 'image', image: { imageSource: 'url', src: '/media/three.jpg', alt: 'Three' } } },
    ];
    const alternating = rows(dom([block({ rows: extra, alternate: true })]));
    expect(alternating).toHaveLength(3);
    expect(alternating.map((row) => row.getAttribute('data-media-side'))).toEqual(['start', 'end', 'start']);
    expect(alternating[1]!.textContent).toContain('Second');
    expect(alternating[2]!.querySelector('img')?.getAttribute('alt')).toBe('Three');

    const fixed = rows(dom([block({ rows: extra, alternate: false, mediaSide: 'end' })]));
    expect(fixed.map((row) => row.getAttribute('data-media-side'))).toEqual(['end', 'end', 'end']);
  });

  it('divider draws a rule between rows, never before the first', () => {
    const extra = [{ heading: doc('Second') }];
    expect(dom([block({ rows: extra, divider: true })]).querySelectorAll('.cmsc-pb-media-text__divider')).toHaveLength(1);
    expect(dom([block({ rows: extra, divider: false })]).querySelectorAll('.cmsc-pb-media-text__divider')).toHaveLength(0);
  });

  it('features render the icon, the title and the body', () => {
    const host = dom([
      block({
        features: [
          { icon: 'truck', title: doc('Fast'), body: 'Short supporting text.' },
          { icon: 'shieldCheck', title: 'Plain title', body: 'Another line.' },
        ],
      }),
    ]);
    const items = Array.from(host.querySelectorAll('.cmsc-pb-media-text__feature'));
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('svg')).not.toBeNull();
    expect(items[0]!.querySelector('.cmsc-pb-media-text__feature-title')?.textContent).toBe('Fast');
    expect(items[0]!.querySelector('.cmsc-pb-media-text__feature-body')?.textContent).toBe('Short supporting text.');
    // A title stored as a plain string renders as text.
    expect(items[1]!.querySelector('.cmsc-pb-media-text__feature-title')?.textContent).toBe('Plain title');
  });

  it('buttons render through the shared button', () => {
    const host = dom([
      block({
        buttons: [
          { label: 'One', link: { kind: 'url', href: '/one' }, style: 'primary', fill: 'solid', size: 'medium' },
          { label: 'Two', link: { kind: 'anchor', anchor: 'contact' }, style: 'secondary', fill: 'outline', size: 'medium' },
        ],
      }),
    ]);
    const buttons = Array.from(host.querySelectorAll<HTMLAnchorElement>('.cmsc-pb-media-text__actions a.cmsc-btn'));
    expect(buttons.map((button) => button.textContent)).toEqual(['One', 'Two']);
    expect(buttons[1]!.getAttribute('href')).toBe('#contact');
  });

  it('the footnote renders below the rows', () => {
    const host = dom([block({ footnote: doc('Prices exclude shipping.') })]);
    const footnote = host.querySelector('.cmsc-pb-media-text__footnote');
    expect(footnote?.textContent).toBe('Prices exclude shipping.');
    // After the last row.
    const all = Array.from(host.querySelectorAll('.cmsc-pb-media-text__row, .cmsc-pb-media-text__footnote'));
    expect(all.at(-1)).toBe(footnote);
  });

  it('an image is lazy and keeps its ratio frame', () => {
    const host = dom([block({ media: { kind: 'image', image: { imageSource: 'url', src: '/media/team.jpg', alt: 'Team' } } })]);
    const img = host.querySelector<HTMLImageElement>('.cmsc-pb-media-text__media img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('Team');
    expect(host.querySelector('.cmsc-pb-media-text__media .cmsc-picture--ratio')).not.toBeNull();
  });

  it('a video renders with a poster and preload="none"', () => {
    const host = dom([block({ media: { kind: 'video', videoAssetId: VIDEO, posterAssetId: POSTER, autoplay: false } })]);
    const video = host.querySelector('.cmsc-pb-media-text__media video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('preload')).toBe('none');
    expect(video!.getAttribute('poster')).toBe(`https://api.example.com/assets/file/${POSTER}`);
    expect(video!.getAttribute('src')).toBe(`https://api.example.com/assets/file/${VIDEO}`);
    // Not autoplaying: the visitor starts it.
    expect(video!.hasAttribute('controls')).toBe(true);
    expect(video!.hasAttribute('autoplay')).toBe(false);

    // Autoplay: muted, inline and looped, no controls, started by the breakpoint-video effect (never `autoplay`).
    const looping = dom([block({ media: { kind: 'video', videoAssetId: VIDEO, posterAssetId: POSTER, autoplay: true } })]).querySelector('video')!;
    expect(looping.hasAttribute('controls')).toBe(false);
    expect(looping.hasAttribute('loop')).toBe(true);
    expect(looping.hasAttribute('playsinline')).toBe(true);
    expect(looping.hasAttribute('autoplay')).toBe(false);
    expect(looping.getAttribute('data-bp')).toBe('all');
  });

  it('carries no section settings: a stray `section` prop renders no section (T111)', () => {
    const top = dom([block({ section: { anchor: 'about', scheme: 'dark' } })]);
    expect(top.querySelector('section.cmsc-section')).toBeNull();
    expect(top.querySelector('#about')).toBeNull();
    expect(top.querySelector('.cmsc-pb-media-text')).not.toBeNull();
  });
});

describe('cms.MediaText video by URL and a mobile video (T142)', () => {
  const asset = (id: string): string => `https://api.example.com/assets/file/${id}`;
  const srcs = (host: HTMLElement): Array<[string | null, string | null]> =>
    Array.from(host.querySelectorAll('.cmsc-pb-media-text__video video')).map((v) => [v.getAttribute('data-bp'), v.getAttribute('src')]);

  it('a library video keeps today\'s single player; a mobile library video makes a breakpoint pair', () => {
    expect(srcs(dom([block({ media: { kind: 'video', videoAssetId: VIDEO } })]))).toEqual([[null, asset(VIDEO)]]);
    const pair = dom([block({ media: { kind: 'video', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER } })]);
    expect(srcs(pair)).toEqual([
      ['mobile', asset(MOBILE_VIDEO)],
      ['desktop', asset(VIDEO)],
    ]);
    for (const video of Array.from(pair.querySelectorAll('video'))) {
      expect(video.getAttribute('preload')).toBe('none');
      expect(video.getAttribute('poster')).toBe(asset(POSTER));
      expect(video.hasAttribute('controls')).toBe(true);
      expect(video.hasAttribute('data-autoplay')).toBe(false);
    }
  });

  it('a URL video takes a mobile URL, made absolute against the media origin', () => {
    const host = dom([
      block({ media: { kind: 'video', videoSource: 'url', videoUrl: 'https://cdn.example.com/wide.mp4', mobileVideoUrl: '/media/square.mp4' } }),
    ]);
    expect(srcs(host)).toEqual([
      ['mobile', 'https://api.example.com/media/square.mp4'],
      ['desktop', 'https://cdn.example.com/wide.mp4'],
    ]);
  });

  it('a library video takes a mobile URL; a mobile library video wins over it', () => {
    expect(srcs(dom([block({ media: { kind: 'video', videoAssetId: VIDEO, mobileVideoUrl: 'https://cdn.example.com/m.mp4' } })]))).toEqual([
      ['mobile', 'https://cdn.example.com/m.mp4'],
      ['desktop', asset(VIDEO)],
    ]);
    expect(
      srcs(dom([block({ media: { kind: 'video', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, mobileVideoUrl: 'https://cdn.example.com/m.mp4' } })])),
    ).toEqual([
      ['mobile', asset(MOBILE_VIDEO)],
      ['desktop', asset(VIDEO)],
    ]);
  });

  it('an autoplaying pair is muted, looped and marked for the breakpoint effect', () => {
    const host = dom([block({ media: { kind: 'video', videoAssetId: VIDEO, mobileVideoUrl: '/m.mp4', autoplay: true } })]);
    const videos = Array.from(host.querySelectorAll('.cmsc-pb-media-text__video video'));
    expect(videos.map((v) => v.getAttribute('data-bp'))).toEqual(['mobile', 'desktop']);
    for (const video of videos) {
      expect(video.hasAttribute('data-autoplay')).toBe(true);
      expect(video.hasAttribute('loop')).toBe(true);
      expect(video.hasAttribute('controls')).toBe(false);
      expect(video.hasAttribute('autoplay')).toBe(false);
    }
  });

  it('the stylesheet shows only the video of the current breakpoint', () => {
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain(".cmsc-pb-media-text__video > video[data-bp='desktop'] { display: none; }");
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{ \.cmsc-pb-media-text__video > video\[data-bp='mobile'\] \{ display: none; \} \.cmsc-pb-media-text__video > video\[data-bp='desktop'\] \{ display: block; \} \}/,
    );
  });

  describe('motion', () => {
    let root: Root | null = null;
    let intersect: ((visible: boolean) => void) | null = null;
    const media = { reduced: false };

    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        get matches() {
          return query.includes('reduced-motion') ? media.reduced : false;
        },
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
            intersect = (visible) => callback([{ isIntersecting: visible }]);
          }
          observe(): void {}
          disconnect(): void {}
        },
      );
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: false });
        return Promise.resolve();
      });
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: true });
      });
    });

    afterEach(() => {
      act(() => root?.unmount());
      root = null;
      intersect = null;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function mount(mediaProps: Record<string, unknown>): void {
      const host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => {
        root!.render(<Render config={config} data={{ root: { props: {} }, content: [block({ media: { kind: 'video', ...mediaProps } })] }} />);
      });
    }

    it('starts the desktop video of an autoplaying pair once on screen', () => {
      media.reduced = false;
      mount({ videoUrl: 'https://cdn.example.com/wide.mp4', videoSource: 'url', mobileVideoUrl: 'https://cdn.example.com/m.mp4', autoplay: true });
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    });

    it('never starts it under reduced motion', () => {
      media.reduced = true;
      mount({ videoUrl: 'https://cdn.example.com/wide.mp4', videoSource: 'url', mobileVideoUrl: 'https://cdn.example.com/m.mp4', autoplay: true });
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('never starts a pair that is not set to autoplay', () => {
      media.reduced = false;
      mount({ videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, autoplay: false });
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
  });
});

/**
 * T160 (R9, owner gap list (a)4): the feature titles take a size (a type token
 * or Custom px, per breakpoint) and a weight, for every row. Nothing chosen is
 * today's 16 px / 600 title, the text straight in the `h3`; a choice wraps it
 * in one span (the shared `ItemText` of T144/T151), so the title's own rule
 * needs no out-ranking.
 */
describe('cms.MediaText feature titles: size and weight (T160)', () => {
  const features = [{ icon: 'check', title: 'Fast', body: 'Delivered in a day.' }];
  const withRow = (props: Record<string, unknown>) =>
    block({ features, rows: [{ media: { kind: 'image', image: {} }, heading: 'Row', features: [{ title: 'Second' }] }], ...props });
  const titles = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.cmsc-pb-media-text__feature-title'));

  it('nothing chosen: today\'s title, the text straight in the heading', () => {
    for (const props of [{}, { featureTitleSize: 'default', featureTitleWeight: 'default' }]) {
      const host = dom([withRow(props)]);
      for (const title of titles(host)) {
        expect(title.tagName).toBe('H3');
        expect(title.querySelector('.cmsc-pb-media-text__feature-title-text')).toBeNull();
        expect(title.getAttribute('style')).toBeNull();
      }
    }
  });

  it('a weight goes on one span in every row\'s titles, with no size class', () => {
    const host = dom([withRow({ featureTitleWeight: 400 })]);
    const spans = titles(host).map((title) => title.querySelector<HTMLElement>('.cmsc-pb-media-text__feature-title-text'));
    expect(spans.map((span) => span?.textContent)).toEqual(['Fast', 'Second']);
    for (const span of spans) {
      expect(span!.style.fontWeight).toBe('400');
      expect(span!.className).toBe('cmsc-pb-media-text__feature-title-text');
    }
  });

  it('a size per breakpoint: the token class and the sizes per breakpoint (published)', () => {
    const host = dom([withRow({ featureTitleSize: { base: 'custom', desktop: 'h5' }, featureTitleSizePx: { base: 20 } })]);
    const span = host.querySelector<HTMLElement>('.cmsc-pb-media-text__feature-title-text')!;
    // R21H (T350, deliberately changed — standing rule 13): the desktop tier's token carries its line height and weight.
    expect(span.className).toBe('cmsc-pb-media-text__feature-title-text cmsc-t--body cmsc-pb-text-size cmsc-pb-text-token');
    expect(span.style.getPropertyValue('--pb-text-lh-lg')).toContain('--cmsb-t-h5-lh');
    expect(span.style.getPropertyValue('--pb-text-size')).toBe('20px');
    expect(span.style.getPropertyValue('--pb-text-size-md')).toBe('20px');
    expect(span.style.getPropertyValue('--pb-text-size-lg')).toContain('--cmsb-t-h5-size');
  });

  it('the editor writes the previewed breakpoint\'s size inline', () => {
    const render = config.components['cms.MediaText']!.render as (props: Record<string, unknown>) => React.ReactElement;
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
        {render({ ...defaults, id: 'mt', features, featureTitleSize: 'custom', featureTitleSizePx: { base: 18, desktop: 22 }, puck: { isEditing: true } })}
      </CmsRenderProvider>,
    );
    // The server snapshot of the preview is the desktop tier.
    expect(host.querySelector<HTMLElement>('.cmsc-pb-media-text__feature-title-text')!.style.fontSize).toBe('22px');
  });

  it('offers the Custom px only once a breakpoint is on Custom', async () => {
    const block = config.components['cms.MediaText'] as unknown as { fields: Record<string, unknown>; resolveFields: (data: unknown, params: unknown) => Record<string, unknown> | Promise<Record<string, unknown>> };
    const fieldsFor = async (props: Record<string, unknown>) =>
      Object.keys(await block.resolveFields({ props: { ...defaults, ...props } }, { parent: null, fields: block.fields, appState: {} }));
    expect(await fieldsFor({})).not.toContain('featureTitleSizePx');
    expect(await fieldsFor({ featureTitleSize: { base: 'h5', desktop: 'custom' } })).toContain('featureTitleSizePx');
    expect((config.components['cms.MediaText'] as { responsiveFields?: string[] }).responsiveFields).toEqual(
      expect.arrayContaining(['featureTitleSize', 'featureTitleSizePx']),
    );
  });

  it('the stylesheet lays the sized text out as a block of the title', () => {
    const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain('.cmsc-pb-media-text__feature-title-text { display: block; }');
  });
});

/**
 * T162 (R9, owner gap list (a)6): a mobile poster, from the library or by URL,
 * for the video shown below the tablet tier, so a mobile video of another ratio
 * does not show the desktop frame cropped before it plays. The library poster
 * wins over the URL; a relative URL is made absolute as the videos' are.
 */
describe('cms.MediaText mobile poster (T162)', () => {
  const asset = (id: string): string => `https://api.example.com/assets/file/${id}`;
  const MOBILE_POSTER = '4e5f6071-8293-4dae-9f20-3b4c5d6e7f80';
  const posters = (host: HTMLElement): Array<[string | null, string | null, string | null]> =>
    Array.from(host.querySelectorAll('.cmsc-pb-media-text__video video')).map((v) => [v.getAttribute('data-bp'), v.getAttribute('src'), v.getAttribute('poster')]);

  it('no mobile poster: today\'s single video with its poster', () => {
    expect(posters(dom([block({ media: { kind: 'video', videoAssetId: VIDEO, posterAssetId: POSTER } })]))).toEqual([[null, asset(VIDEO), asset(POSTER)]]);
  });

  it('a pair: the mobile video takes the mobile poster, the desktop one keeps the poster', () => {
    const host = dom([block({ media: { kind: 'video', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER, mobilePosterAssetId: MOBILE_POSTER } })]);
    expect(posters(host)).toEqual([
      ['mobile', asset(MOBILE_VIDEO), asset(MOBILE_POSTER)],
      ['desktop', asset(VIDEO), asset(POSTER)],
    ]);
  });

  it('a mobile poster URL, made absolute; the library poster wins over it', () => {
    const media = { kind: 'video', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER };
    expect(posters(dom([block({ media: { ...media, mobilePosterUrl: '/media/tall.jpg' } })]))[0]).toEqual(['mobile', asset(MOBILE_VIDEO), 'https://api.example.com/media/tall.jpg']);
    expect(posters(dom([block({ media: { ...media, mobilePosterUrl: '/media/tall.jpg', mobilePosterAssetId: MOBILE_POSTER } })]))[0]).toEqual([
      'mobile',
      asset(MOBILE_VIDEO),
      asset(MOBILE_POSTER),
    ]);
  });

  it('one video with its own mobile poster: the same file twice, one per breakpoint, each loading nothing before it plays', () => {
    const host = dom([block({ media: { kind: 'video', videoAssetId: VIDEO, posterAssetId: POSTER, mobilePosterUrl: 'https://cdn.example.com/tall.jpg' } })]);
    expect(posters(host)).toEqual([
      ['mobile', asset(VIDEO), 'https://cdn.example.com/tall.jpg'],
      ['desktop', asset(VIDEO), asset(POSTER)],
    ]);
    for (const video of Array.from(host.querySelectorAll('video'))) expect(video.getAttribute('preload')).toBe('none');
  });

  it('a mobile poster equal to the poster changes nothing', () => {
    expect(posters(dom([block({ media: { kind: 'video', videoAssetId: VIDEO, posterAssetId: POSTER, mobilePosterAssetId: POSTER } })]))).toEqual([
      [null, asset(VIDEO), asset(POSTER)],
    ]);
  });
});

/**
 * R17 (T217): a poster source, as the hero's and the video block's — the
 * library (unset, today's: the library image before a URL) or URLs, for both
 * posters. A stored video with no source renders as before.
 */
describe('cms.MediaText poster source (R17, T217)', () => {
  const VIDEO = '00000000-0000-4000-8000-000000000001';
  const POSTER = '00000000-0000-4000-8000-000000000002';
  const posterOf = (media: Record<string, unknown>): string | null =>
    dom([block({ media: { kind: 'video', videoAssetId: VIDEO, ...media } })]).querySelector('.cmsc-pb-media-text__video video')!.getAttribute('poster');

  it('unset: the library poster, as before; a poster URL alone is used too', () => {
    expect(posterOf({ posterAssetId: POSTER, posterUrl: 'https://cdn.example.com/p.jpg' })).toBe(`https://api.example.com/assets/file/${POSTER}`);
    expect(posterOf({ posterUrl: '/media/p.jpg' })).toBe('https://api.example.com/media/p.jpg');
  });

  it('URL: the poster URL first, the library image as the fallback', () => {
    expect(posterOf({ posterSource: 'url', posterAssetId: POSTER, posterUrl: 'https://cdn.example.com/p.jpg' })).toBe('https://cdn.example.com/p.jpg');
    expect(posterOf({ posterSource: 'url', posterAssetId: POSTER })).toBe(`https://api.example.com/assets/file/${POSTER}`);
  });
});
