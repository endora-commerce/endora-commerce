// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import type { CmsBlogPostCard } from '../schema/blog-types.js';
import { blockDataKey, blogPostsDataRequest } from '../utils/block-data.js';
import { CatalogPreviewProvider } from './catalog-preview-context.js';
import { CmsRenderProvider } from './render-context.js';
import { latestPostsLook } from './LatestPosts.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T068, US6, FR-026,
 * contracts/blocks.md `blog.LatestPosts` — the newest posts as cards (image,
 * category chip, title, read-more link), in a carousel or a grid, under an
 * optional header with a button. With no posts, customers see nothing and the
 * preview says "No posts". The posts come from the page's server render
 * (`utils/block-data.ts`), never from an effect on the storefront.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['blog.LatestPosts']?.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function card(slug: string, overrides: Partial<CmsBlogPostCard> = {}): CmsBlogPostCard {
  return {
    id: `id-${slug}`,
    slug,
    name: `Post ${slug}`,
    publishedAt: '2026-04-01T00:00:00.000Z',
    excerpt: null,
    mainImageUrl: `https://cdn.example.com/${slug}.jpg`,
    primaryCategorySlug: 'news',
    primaryCategoryName: 'News',
    url: `/blog/${slug}`,
    ...overrides,
  };
}

function dom(
  props: Record<string, unknown> = {},
  options: { posts?: CmsBlogPostCard[]; preview?: boolean; language?: string } = {},
): HTMLElement {
  const merged: Record<string, unknown> = { ...defaults, id: 'latest-1', ...props };
  const request = blogPostsDataRequest({
    limit: merged['limit'] as number | undefined,
    categorySlug: merged['categorySlug'] as string | undefined,
  });
  const data = options.posts ? { [blockDataKey(request)]: options.posts } : {};
  const content = [{ type: 'blog.LatestPosts', props: merged }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <BlockRenderEnvironmentProvider value={{ language: options.language ?? 'en', preview: options.preview === true }}>
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={{}} mediaBaseUrl="https://api.example.com">
        <CatalogPreviewProvider data={data}>
          <Render config={config} data={{ root: { props: {} }, content }} />
        </CatalogPreviewProvider>
      </CmsRenderProvider>
    </BlockRenderEnvironmentProvider>,
  );
  return host;
}

describe('blog.LatestPosts (T068)', () => {
  it('is registered, with neutral defaults: six posts in a carousel and a read-more label', () => {
    expect(config.components['blog.LatestPosts']).toBeDefined();
    expect(defaults).toMatchObject({ limit: 6, layout: 'carousel' });
    expect(typeof defaults['readMoreLabel']).toBe('string');
  });

  it('renders the provided posts as cards in the carousel: image, category chip, title and read-more link', () => {
    const host = dom({ readMoreLabel: 'Read more' }, { posts: [card('newest'), card('older', { mainImageUrl: null, primaryCategoryName: null, primaryCategorySlug: null })] });
    expect(host.querySelector('.cmsc-pb-carousel')).not.toBeNull();
    const cards = host.querySelectorAll('.cmsc-pb-post-card');
    expect(cards).toHaveLength(2);
    const first = cards[0]!;
    expect(first.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/newest.jpg');
    expect(first.querySelector('.cmsc-pb-post-card__chip')?.textContent).toBe('News');
    expect(first.querySelector('.cmsc-pb-post-card__title')?.textContent).toBe('Post newest');
    const more = first.querySelector('a.cmsc-pb-post-card__more');
    expect(more?.textContent).toBe('Read more');
    expect(more?.getAttribute('href')).toBe('/blog/newest');
    // A post with no image keeps its 2:1 frame; with no category, no chip.
    expect(cards[1]!.querySelector('.cmsc-pb-post-card__media')).not.toBeNull();
    expect(cards[1]!.querySelector('.cmsc-pb-post-card__chip')).toBeNull();
  });

  it('renders the same cards in a grid layout, without a carousel', () => {
    const host = dom({ layout: 'grid' }, { posts: [card('a'), card('b'), card('c')] });
    expect(host.querySelector('.cmsc-pb-carousel')).toBeNull();
    const grid = host.querySelector('.cmsc-pb-latest-posts__grid');
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll('.cmsc-pb-post-card')).toHaveLength(3);
  });

  it('falls back to /blog/<slug> for a card from a backend that sends no url', () => {
    const { url: _url, ...withoutUrl } = card('legacy');
    const host = dom({}, { posts: [withoutUrl] });
    expect(host.querySelector('a.cmsc-pb-post-card__more')?.getAttribute('href')).toBe('/blog/legacy');
  });

  it('renders nothing for customers with no posts, and "No posts" in the preview', () => {
    const customers = dom({ header: { heading: doc('Latest news') } }, { posts: [] });
    expect(customers.querySelector('.cmsc-pb-latest-posts')).toBeNull();
    expect(customers.textContent).toBe('');
    const preview = dom({}, { posts: [], preview: true });
    expect(preview.textContent).toContain('No posts');
  });

  it('renders the header with its heading and button', () => {
    const host = dom(
      {
        header: {
          heading: doc('Latest news'),
          lead: 'From the newsroom.',
          button: { label: 'All news', link: { kind: 'url', href: '/blog' }, style: 'primary', fill: 'outline', size: 'medium' },
        },
      },
      { posts: [card('a')] },
    );
    expect(host.querySelector('.cmsc-pb-carousel__heading')?.textContent).toBe('Latest news');
    expect(host.textContent).toContain('From the newsroom.');
    const button = Array.from(host.querySelectorAll('a')).find((a) => a.textContent?.includes('All news'));
    expect(button?.getAttribute('href')).toBe('/blog');
  });

  it('renders the header above a grid as well', () => {
    const host = dom(
      {
        layout: 'grid',
        header: { button: { label: 'All news', link: { kind: 'url', href: '/blog' }, style: 'primary', fill: 'solid', size: 'medium' } },
      },
      { posts: [card('a')] },
    );
    expect(Array.from(host.querySelectorAll('a')).some((a) => a.textContent?.includes('All news'))).toBe(true);
  });
});

/**
 * T189 (R15): the post card's look — background, corners, padding, text
 * padding, image ratio per breakpoint, zoom on hover, chip style, title size
 * and weight, the read-more link's icon, alignment and weight — and the
 * header's lead size and colour and its button's placement and width per
 * breakpoint. Unset, every one renders today's card byte for byte.
 */
describe('blog.LatestPosts card look and header button placement (T189)', () => {
  const builtCss = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css'), 'utf8').replace(/\s+/g, '');
  const posts = [card('a'), card('b')];
  const BUTTON = { label: 'All news', link: { kind: 'url', href: '/blog' }, style: 'primary', fill: 'solid', size: 'medium' };
  const HEADER = { heading: doc('Latest news'), lead: 'From the newsroom.', button: BUTTON };
  const rootOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-latest-posts')!;
  const styleOf = (host: HTMLElement): string => rootOf(host).getAttribute('style') ?? '';

  it('unset, Default or unknown values render today\'s cards and header', () => {
    const today = dom({ header: HEADER }, { posts }).innerHTML;
    for (const props of [
      { chipStyle: 'filled' },
      { chipStyle: 'bogus' },
      { readMoreIcon: 'none' },
      { readMoreAlign: 'start' },
      { readMoreWeight: 'default' },
      { cardTitleWeight: 'default' },
      { cardTitleSize: 'default' },
      { leadSize: 'default' },
      { hoverZoom: false },
      { cardBackground: 'not-a-colour' },
      { leadColor: '' },
      { cardRadius: 'bogus' },
      { imageRatio: 'wide' },
      { headerButtonPlacement: 'below' },
      { headerButtonPlacement: { base: 'below', desktop: 'below' } },
      { headerButtonFullWidth: 'auto' },
      { cardPadding: undefined, cardTextPadding: null },
    ]) {
      expect(dom({ header: HEADER, ...props }, { posts }).innerHTML, JSON.stringify(props)).toBe(today);
    }
  });

  it('a card background, corners and zoom on hover are written on the block root', () => {
    const host = dom({ cardBackground: '#e2e8f0', cardRadius: 'none', hoverZoom: true }, { posts });
    expect(styleOf(host)).toContain('--cmsc-post-card-bg:#e2e8f0');
    expect(styleOf(host)).toContain('--cmsc-post-card-radius:0px');
    expect(rootOf(host).classList).toContain('cmsc-pb-latest-posts--zoom');
    expect(styleOf(dom({ cardBackground: 'token:secondary' }, { posts }))).toMatch(/--cmsc-post-card-bg:var\(--cmsb-color-secondary/);
  });

  it('the card padding and the text padding are values per breakpoint; a tier left unset keeps today\'s', () => {
    const pad = dom({ cardPadding: 'custom', cardPaddingPx: 12 }, { posts });
    expect(rootOf(pad).classList).toContain('cmsc-pb-latest-posts--card-pad');
    expect(styleOf(pad)).toContain('--cmsc-post-card-pad:12px;--cmsc-post-card-pad-md:12px;--cmsc-post-card-pad-lg:12px');
    const desktopOnly = dom({ cardPadding: { desktop: 'custom' }, cardPaddingPx: { desktop: 20 } }, { posts });
    expect(styleOf(desktopOnly)).toContain('--cmsc-post-card-pad:0px;--cmsc-post-card-pad-md:0px;--cmsc-post-card-pad-lg:20px');
    const text = dom({ cardTextPadding: { base: 'custom', desktop: 'custom' }, cardTextPaddingPx: { base: 12, desktop: 24 } }, { posts });
    expect(rootOf(text).classList).toContain('cmsc-pb-latest-posts--text-pad');
    expect(styleOf(text)).toContain('--cmsc-post-text-top:12px;--cmsc-post-text-side:12px;--cmsc-post-text-top-md:12px;--cmsc-post-text-side-md:12px;--cmsc-post-text-top-lg:24px;--cmsc-post-text-side-lg:24px');
    // Below a desktop-only value, today's: 16 px above, none beside.
    const textDesktop = dom({ cardTextPadding: { desktop: 'l' } }, { posts });
    expect(styleOf(textDesktop)).toMatch(/--cmsc-post-text-top:16px;--cmsc-post-text-side:0px;--cmsc-post-text-top-md:16px;--cmsc-post-text-side-md:0px;--cmsc-post-text-top-lg:var\(--cmsb-space-l, \d+px\);--cmsc-post-text-side-lg:var\(--cmsb-space-l, \d+px\)/);
  });

  it('the image ratio is a value per breakpoint, any aspect token or a custom w:h', () => {
    const host = dom({ imageRatio: { base: '2:1', desktop: '5:2' } }, { posts });
    expect(styleOf(host)).toContain('--cmsc-post-ratio:2 / 1;--cmsc-post-ratio-md:2 / 1;--cmsc-post-ratio-lg:5 / 2');
    expect(styleOf(dom({ imageRatio: '1:1' }, { posts }))).toContain('--cmsc-post-ratio:1 / 1');
  });

  it('the chip can be an outline or not shown', () => {
    expect(rootOf(dom({ chipStyle: 'outline' }, { posts })).classList).toContain('cmsc-pb-latest-posts--chip-outline');
    const none = dom({ chipStyle: 'none' }, { posts });
    expect(none.querySelector('.cmsc-pb-post-card__chip')).toBeNull();
    expect(none.querySelector('.cmsc-pb-post-card__title')).not.toBeNull();
  });

  it('the title takes a size and a weight per breakpoint on one span inside its link', () => {
    const host = dom({ cardTitleSize: 'custom', cardTitleSizePx: { base: 18, desktop: 24 }, cardTitleWeight: 500 }, { posts });
    const span = host.querySelector<HTMLElement>('.cmsc-pb-post-card__title a > .cmsc-pb-post-card__title-text')!;
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('Post a');
    expect(span.className).toContain('cmsc-pb-text-size');
    expect(span.getAttribute('style')).toContain('--pb-text-size:18px');
    expect(span.getAttribute('style')).toContain('--pb-text-size-lg:24px');
    expect(span.style.fontWeight).toBe('500');
    const perTier = dom({ cardTitleWeight: { base: 400, desktop: 600 } }, { posts }).querySelector<HTMLElement>('.cmsc-pb-post-card__title-text')!;
    expect(perTier.className).toContain('cmsc-pb-item-weight');
  });

  it('the read-more link takes an icon, the end of the card and a weight', () => {
    const host = dom({ readMoreIcon: 'plus', readMoreAlign: 'end', readMoreWeight: 500 }, { posts });
    expect(rootOf(host).classList).toContain('cmsc-pb-latest-posts--more-end');
    const more = host.querySelector<HTMLElement>('a.cmsc-pb-post-card__more')!;
    expect(more.classList).toContain('cmsc-pb-post-card__more--icon');
    const icon = more.querySelector('svg.cmsc-pb-post-card__more-icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(more.textContent).toBe('Read more');
    expect(more.style.fontWeight).toBe('500');
    expect(dom({ readMoreIcon: 'arrow' }, { posts }).querySelector('svg.cmsc-pb-post-card__more-icon')).not.toBeNull();
  });

  it('the lead takes a size per breakpoint and a colour', () => {
    const host = dom({ header: HEADER, leadSize: 'custom', leadSizePx: 18, leadColor: '#000000' }, { posts });
    const lead = host.querySelector<HTMLElement>('.cmsc-pb-carousel__lead')!;
    const span = lead.querySelector<HTMLElement>('.cmsc-pb-carousel__lead-text')!;
    expect(span.textContent).toBe('From the newsroom.');
    expect(span.getAttribute('style')).toContain('--pb-text-size:18px');
    expect(rootOf(host).classList).toContain('cmsc-pb-latest-posts--lead-color');
    expect(styleOf(host)).toContain('--cmsc-lp-lead-color:#000000');
  });

  it('R22I (T379): the lead takes a weight — R23 (T435): one value, a stored per-breakpoint one read as its desktop value; unset, none', () => {
    const plain = dom({ header: HEADER }, { posts }).querySelector<HTMLElement>('.cmsc-pb-carousel__lead')!;
    expect(plain.querySelector('.cmsc-pb-carousel__lead-text')).toBeNull();
    const span = dom({ header: HEADER, leadWeight: { base: 400, desktop: 500 } }, { posts }).querySelector<HTMLElement>('.cmsc-pb-carousel__lead-text')!;
    expect(span.className).not.toContain('cmsc-pb-item-weight');
    expect(span.style.fontWeight).toBe('500');
    const one = dom({ header: HEADER, leadWeight: 500 }, { posts }).querySelector<HTMLElement>('.cmsc-pb-carousel__lead-text')!;
    expect(one.style.fontWeight).toBe('500');
  });

  it('the header button sits below the lead, at the header\'s end or after the posts, per breakpoint', () => {
    const end = dom({ header: HEADER, headerButtonPlacement: 'end' }, { posts });
    expect(rootOf(end).classList).toContain('cmsc-pb-latest-posts--action-end');
    expect(end.querySelector('.cmsc-pb-carousel__header-action')).not.toBeNull();
    expect(end.querySelector('.cmsc-pb-latest-posts__action')).toBeNull();
    const split = dom({ header: HEADER, headerButtonPlacement: { base: 'after', desktop: 'end' }, headerButtonFullWidth: { base: 'full', tablet: 'auto' } }, { posts });
    const root = rootOf(split);
    expect(root.classList).toContain('cmsc-pb-latest-posts--action-after');
    expect(root.classList).toContain('cmsc-pb-latest-posts--lg-action-end');
    expect(root.classList).not.toContain('cmsc-pb-latest-posts--md-action-after');
    const inHeader = split.querySelector<HTMLElement>('.cmsc-pb-carousel__header-action')!;
    const after = split.querySelector<HTMLElement>('.cmsc-pb-latest-posts__action')!;
    expect(after).not.toBeNull();
    // After the carousel, not inside it.
    expect(after.parentElement).toBe(root);
    expect(after.previousElementSibling?.classList).toContain('cmsc-pb-carousel');
    for (const action of [inHeader, after]) {
      expect(action.querySelector('a')?.getAttribute('href')).toBe('/blog');
      expect(action.classList).toContain('cmsc-btn-list--full');
      expect(action.classList).toContain('cmsc-btn-list--md-auto');
    }
    // Only after the posts at every width: no copy in the header.
    const afterOnly = dom({ header: HEADER, headerButtonPlacement: 'after' }, { posts });
    expect(afterOnly.querySelector('.cmsc-pb-carousel__header-action')).toBeNull();
    expect(afterOnly.querySelector('.cmsc-pb-latest-posts__action a')?.textContent).toContain('All news');
    // A grid places it the same way.
    const grid = dom({ layout: 'grid', header: HEADER, headerButtonPlacement: 'after' }, { posts });
    expect(grid.querySelector('.cmsc-pb-latest-posts__action')?.previousElementSibling?.classList).toContain('cmsc-pb-latest-posts__grid');
  });

  it('the editor writes the previewed breakpoint\'s values only', () => {
    const props = {
      cardPadding: { base: 'custom', desktop: 'custom' }, cardPaddingPx: { base: 8, desktop: 12 },
      imageRatio: { base: '1:1', desktop: '2:1' },
      headerButtonPlacement: { base: 'after', desktop: 'end' },
    };
    const desktop = latestPostsLook(props as never, 'desktop');
    expect(desktop.classes).toContain('cmsc-pb-latest-posts--action-end');
    expect(desktop.classes.join(' ')).not.toMatch(/--(md|lg)-action/);
    expect(desktop.vars).toMatchObject({ '--cmsc-post-card-pad': '12px', '--cmsc-post-ratio': '2 / 1' });
    expect(Object.keys(desktop.vars).some((key) => /-(md|lg)$/.test(key))).toBe(false);
    expect(latestPostsLook(props as never, 'mobile').classes).toContain('cmsc-pb-latest-posts--action-after');
  });

  it('the stylesheet reads each value from its breakpoint up, with today\'s look as the fallback', () => {
    const css = builtCss();
    expect(css).toContain('.cmsc-pb-post-card{');
    expect(css).toMatch(/\.cmsc-pb-post-card\{[^}]*background-color:var\(--cmsc-post-card-bg,var\(--cmsb-bg,#fff\)\)/);
    expect(css).toMatch(/\.cmsc-pb-post-card\{[^}]*border-radius:var\(--cmsc-post-card-radius,8px\)/);
    expect(css).toMatch(/\.cmsc-pb-post-card__media\{[^}]*aspect-ratio:var\(--cmsc-post-ratio,2\/1\)/);
    expect(css).toContain('.cmsc-pb-post-card__media{aspect-ratio:var(--cmsc-post-ratio-md,var(--cmsc-post-ratio,2/1))}');
    expect(css).toContain('.cmsc-pb-post-card__media{aspect-ratio:var(--cmsc-post-ratio-lg,var(--cmsc-post-ratio-md,var(--cmsc-post-ratio,2/1)))}');
    expect(css).toMatch(/\.cmsc-pb-latest-posts--card-pad\.cmsc-pb-post-card\{[^}]*padding-top:var\(--cmsc-post-card-pad\)/);
    expect(css).toMatch(/\.cmsc-pb-latest-posts--text-pad\.cmsc-pb-post-card__body\{[^}]*padding-top:var\(--cmsc-post-text-top-lg,var\(--cmsc-post-text-top-md,var\(--cmsc-post-text-top\)\)\)/);
    expect(css).toMatch(/\.cmsc-pb-latest-posts--text-pad\.cmsc-pb-post-card__body\{[^}]*padding-left:var\(--cmsc-post-text-side-lg,var\(--cmsc-post-text-side-md,var\(--cmsc-post-text-side\)\)\)/);
    expect(css).toContain('.cmsc-pb-latest-posts--action-after.cmsc-pb-carousel__header-action{display:none}');
    expect(css).toMatch(/\.cmsc-pb-latest-posts--lg-action-end\.cmsc-pb-carousel__header-content\{[^}]*display:grid/);
    // The zoom does not move under reduced motion.
    expect(css).toMatch(/prefers-reduced-motion:no-preference\)\{[^@]*\.cmsc-pb-latest-posts--zoom\.cmsc-pb-post-card__mediaimg\{transition:transform/);
  });
});

describe('blog.LatestPosts read-more label in the page language (#1684)', () => {
  it('a stored block with no label reads the content default of the language it renders in', () => {
    const pl = dom({ readMoreLabel: undefined }, { posts: [card('newest')], language: 'pl-PL' });
    expect(pl.querySelector('a.cmsc-pb-post-card__more')?.textContent).toBe('Czytaj więcej');
    const en = dom({ readMoreLabel: undefined }, { posts: [card('newest')], language: 'en-US' });
    expect(en.querySelector('a.cmsc-pb-post-card__more')?.textContent).toBe('Read more');
  });
});
