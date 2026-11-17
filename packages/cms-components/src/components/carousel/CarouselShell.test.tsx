// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarouselShell, CarouselSlides, type CarouselShellProps } from './CarouselShell.js';
import { CmsRenderProvider } from '../render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T051, US4, FR-019, FR-022, research
 * R-12 — the one carousel shell every carousel shares.
 *
 * - **Slides per view and gap are CSS.** The server writes `--pb-spv`, `-md`
 *   and `-lg` (and the gap likewise) and renders every slide; no script picks
 *   a tier, so nothing shifts on hydration (SC-005a).
 * - **Fade** stacks the slides in one cell and hides the inactive ones from
 *   assistive technology.
 * - **Controls** are `<button>` elements with accessible names, and are hidden
 *   once everything already fits (`scrollWidth <= clientWidth`).
 * - **Autoplay** is off by default and never starts under reduced motion.
 * - **Semantics**: `role="region"` with `aria-roledescription="carousel"`, and
 *   each slide a group with `aria-roledescription="slide"` named "n of m".
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Puck's drag-and-drop layer (reached through the editor preview store) observes element sizes
// when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const media = { reduced: false };

beforeEach(() => {
  media.reduced = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('reduced-motion') ? media.reduced : false;
    },
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function slides(count: number): ReactElement[] {
  return Array.from({ length: count }, (_, index) => <p key={index}>Slide text {index + 1}</p>);
}

/** Server-rendered markup, parsed: what a crawler and the first paint receive. */
function serverDom(props: Partial<CarouselShellProps>, count = 3): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(<CarouselShell {...props}>{slides(count)}</CarouselShell>);
  return host;
}

/** A client render, effects run. */
function clientDom(props: Partial<CarouselShellProps>, count = 3): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<CarouselShell {...props}>{slides(count)}</CarouselShell>));
  return host;
}

function region(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>('[role="region"]');
  if (!found) throw new Error(`no carousel region:\n${host.innerHTML}`);
  return found;
}

function slideGroups(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'));
}

describe('CarouselShell (T051)', () => {
  it('writes slides per view and gap per breakpoint as custom properties on the server and renders every slide', () => {
    const host = serverDom({ slidesPerView: { base: 1.25, tablet: 2, desktop: 3 }, gap: { base: 12, desktop: 24 } }, 5);
    const style = region(host).getAttribute('style') ?? '';
    expect(style).toContain('--pb-spv:1.25');
    expect(style).toContain('--pb-spv-md:2');
    expect(style).toContain('--pb-spv-lg:3');
    expect(style).toContain('--pb-gap:12px');
    expect(style).toContain('--pb-gap-md:12px');
    expect(style).toContain('--pb-gap-lg:24px');
    // Every slide's content is in the HTML (FR-022), none sized by script.
    expect(slideGroups(host)).toHaveLength(5);
    for (let index = 1; index <= 5; index += 1) expect(host.textContent).toContain(`Slide text ${index}`);
    for (const slide of slideGroups(host)) expect(slide.getAttribute('style') ?? '').not.toMatch(/flex|width/);
  });

  it('a plain number of slides per view and a CSS gap apply at every tier; the default is one per view, 16 px apart', () => {
    const style = region(serverDom({ slidesPerView: 2, gap: 'var(--cmsb-space-s, 16px)' })).getAttribute('style') ?? '';
    expect(style).toContain('--pb-spv:2;--pb-spv-md:2;--pb-spv-lg:2');
    expect(style).toContain('--pb-gap:var(--cmsb-space-s, 16px)');
    const defaults = region(serverDom({})).getAttribute('style') ?? '';
    expect(defaults).toContain('--pb-spv:1;--pb-spv-md:1;--pb-spv-lg:1');
    expect(defaults).toContain('--pb-gap:16px');
  });

  it('server and client agree: the first client render writes the same markup the server sent (no hydration shift)', () => {
    const props = { slidesPerView: { base: 1.15, tablet: 2, desktop: 3 } };
    // The DOM serialises a style with spaces; React's server render without them.
    const flat = (value: string | null) => (value ?? '').replace(/\s+/g, '').replace(/;$/, '');
    const server = region(serverDom(props, 4)).getAttribute('style');
    const client = region(clientDom(props, 4)).getAttribute('style');
    expect(flat(client)).toBe(flat(server));
    expect(flat(server)).toContain('--pb-spv:1.15;--pb-spv-md:2;--pb-spv-lg:3');
  });

  it('fade stacks the slides at one per view and hides the inactive ones, toggling aria-hidden as it advances', () => {
    const server = serverDom({ effect: 'fade', slidesPerView: { base: 2, desktop: 3 } });
    const root0 = region(server);
    expect(root0.className).toContain('cmsc-pb-carousel--fade');
    expect(root0.getAttribute('style')).toContain('--pb-spv:1;--pb-spv-md:1;--pb-spv-lg:1');
    expect(slideGroups(server).map((slide) => slide.getAttribute('aria-hidden'))).toEqual([null, 'true', 'true']);

    const host = clientDom({ effect: 'fade' });
    const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next slide"]')!;
    act(() => next.click());
    expect(slideGroups(host).map((slide) => slide.getAttribute('aria-hidden'))).toEqual(['true', null, 'true']);
  });

  it('arrows are buttons with accessible names, and each dot names the slide it shows', () => {
    const host = serverDom({ showArrows: true });
    const previous = host.querySelector('button[aria-label="Previous slide"]');
    const next = host.querySelector('button[aria-label="Next slide"]');
    expect(previous?.tagName).toBe('BUTTON');
    expect(next?.tagName).toBe('BUTTON');
    expect(previous?.getAttribute('type')).toBe('button');
    // The buttons control the track.
    const track = host.querySelector('.cmsc-pb-carousel__track')!;
    expect(track.id).toBeTruthy();
    expect(next?.getAttribute('aria-controls')).toBe(track.id);

    const labelled = serverDom({ labels: { previous: 'Poprzedni slajd', next: 'Następny slajd', slide: (n, m) => `${n} z ${m}` } });
    expect(labelled.querySelector('button[aria-label="Następny slajd"]')).not.toBeNull();
    expect(slideGroups(labelled)[1]?.getAttribute('aria-label')).toBe('2 z 3');

    // Fade's dots are known on the server: one per slide, the current one marked.
    const fade = clientDom({ effect: 'fade', showDots: true });
    const dots = Array.from(fade.querySelectorAll<HTMLButtonElement>('.cmsc-pb-carousel__dot'));
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual(['Go to slide 1', 'Go to slide 2', 'Go to slide 3']);
    expect(dots[0]?.getAttribute('aria-current')).toBe('true');
  });

  it('hides the controls when everything already fits (scrollWidth <= clientWidth), and shows them when it does not', () => {
    const geometry = { scrollWidth: 900, clientWidth: 900 };
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cmsc-pb-carousel__track') ? geometry.scrollWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cmsc-pb-carousel__track') ? geometry.clientWidth : 0;
    });

    const fits = clientDom({ showArrows: true, showDots: true, controlsPlacement: 'below' });
    const controls = Array.from(fits.querySelectorAll<HTMLElement>('.cmsc-pb-carousel__controls'));
    expect(controls.length).toBeGreaterThan(0);
    for (const group of controls) expect(group.hidden).toBe(true);
    act(() => root!.unmount());
    root = null;

    geometry.scrollWidth = 1800;
    const overflows = clientDom({ showArrows: true, showDots: true, controlsPlacement: 'below' });
    for (const group of Array.from(overflows.querySelectorAll<HTMLElement>('.cmsc-pb-carousel__controls'))) {
      expect(group.hidden).toBe(false);
    }
  });

  it('autoplay is off by default, advances when on, and never starts under reduced motion', () => {
    vi.useFakeTimers();
    const page = (host: HTMLElement) => region(host).getAttribute('data-pb-carousel-page');

    const off = clientDom({ effect: 'fade' });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(page(off)).toBe('0');
    act(() => root!.unmount());
    root = null;

    const on = clientDom({ effect: 'fade', autoplay: true, intervalMs: 3000 });
    act(() => { vi.advanceTimersByTime(3100); });
    expect(page(on)).toBe('1');
    act(() => root!.unmount());
    root = null;

    media.reduced = true;
    const reduced = clientDom({ effect: 'fade', autoplay: true, intervalMs: 3000 });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(page(reduced)).toBe('0');
  });

  it('is a region with the carousel role description, and each slide a group named "n of m"', () => {
    const host = serverDom({ label: 'Downloads' }, 4);
    const carousel = region(host);
    expect(carousel.getAttribute('aria-roledescription')).toBe('carousel');
    expect(carousel.getAttribute('aria-label')).toBe('Downloads');
    expect(region(serverDom({})).getAttribute('aria-label')).toBe('Carousel');
    const groups = slideGroups(host);
    expect(groups.map((slide) => slide.getAttribute('role'))).toEqual(['group', 'group', 'group', 'group']);
    expect(groups.map((slide) => slide.getAttribute('aria-label'))).toEqual(['1 of 4', '2 of 4', '3 of 4', '4 of 4']);
  });

  it('a slot\'s own list component wraps each slot child as a slide, skipping the ones that render nothing', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      <CarouselShell slotMode>
        <CarouselSlides className="cmsc-pb-content-slider-slot">
          {[<p key="a">A</p>, null, <p key="b">B</p>]}
        </CarouselSlides>
      </CarouselShell>,
    );
    expect(slideGroups(host).map((slide) => slide.getAttribute('aria-label'))).toEqual(['1 of 2', '2 of 2']);
    expect(host.querySelector('.cmsc-pb-carousel__slides.cmsc-pb-content-slider-slot')).not.toBeNull();
  });

  it('places the controls in the header beside the header content, below the track, or over it, and bleeds past the content edge', () => {
    const header = serverDom({ controlsPlacement: 'header', header: <h2>Latest</h2> });
    const head = header.querySelector('.cmsc-pb-carousel__header')!;
    expect(head.textContent).toContain('Latest');
    expect(head.querySelector('button[aria-label="Next slide"]')).not.toBeNull();

    const below = serverDom({ controlsPlacement: 'below' });
    expect(below.querySelector('.cmsc-pb-carousel__viewport button')).toBeNull();
    expect(below.querySelector('.cmsc-pb-carousel__controls--below button[aria-label="Next slide"]')).not.toBeNull();

    const overlay = serverDom({ controlsPlacement: 'overlay' });
    expect(overlay.querySelector('.cmsc-pb-carousel__viewport button[aria-label="Next slide"]')).not.toBeNull();

    expect(region(serverDom({ bleed: 'end' })).className).toContain('cmsc-pb-carousel--bleed-end');
    expect(region(serverDom({ bleed: 'both' })).className).toContain('cmsc-pb-carousel--bleed-both');
    expect(region(serverDom({})).className).not.toContain('bleed');
  });

  it('keeps the editor preview mode: no on-canvas arrows, the previewed page shown, the rest hidden by CSS', () => {
    const host = serverDom({ editorPreview: true, previewPage: 1, slidesPerView: { base: 1, desktop: 2 }, previewTier: 'desktop', editorCarouselId: 'slider-1' }, 5);
    expect(host.querySelector('.cmsc-pb-carousel__arrow')).toBeNull();
    const carousel = host.querySelector('.cmsc-pb-carousel')!;
    expect(carousel.className).toContain('cmsc-pb-carousel--editor-preview');
    expect(carousel.getAttribute('data-pb-carousel-page')).toBe('1');
    expect(carousel.getAttribute('data-pb-carousel-uid')).toBe('slider-1');
    const css = host.querySelector('style')?.textContent ?? '';
    expect(css).toContain(':nth-child(-n+2)');
    expect(css).toContain(':nth-child(n+5)');
  });
});

describe('CarouselShell — the words of the page language (T095)', () => {
  // The storefront passes the page language's words through the render context
  // (strings with `{n}`/`{m}` placeholders: a server component cannot hand a
  // client component a function); a block's own `labels` still win.
  const polish = {
    carousel: 'Karuzela',
    previous: 'Poprzedni slajd',
    next: 'Następny slajd',
    slide: '{n} z {m}',
    goToSlide: 'Przejdź do slajdu {n}',
    goToPage: 'Przejdź do strony {n}',
    pause: 'Wstrzymaj automatyczne przewijanie',
    play: 'Włącz automatyczne przewijanie',
  };

  function inContext(props: Partial<CarouselShellProps>): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} carouselLabels={polish}>
        <CarouselShell {...props}>{slides(3)}</CarouselShell>
      </CmsRenderProvider>,
    );
    return host;
  }

  it('names the controls, the slides and the region in the page language', () => {
    const host = inContext({ showArrows: true, effect: 'fade', showDots: true, autoplay: true });
    expect(host.querySelector('button[aria-label="Poprzedni slajd"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Następny slajd"]')).not.toBeNull();
    expect(slideGroups(host).map((group) => group.getAttribute('aria-label'))).toEqual(['1 z 3', '2 z 3', '3 z 3']);
    expect(region(host).getAttribute('aria-label')).toBe('Karuzela');
    expect(
      Array.from(host.querySelectorAll('.cmsc-pb-carousel__dot')).map((dot) => dot.getAttribute('aria-label')),
    ).toEqual(['Przejdź do slajdu 1', 'Przejdź do slajdu 2', 'Przejdź do slajdu 3']);
  });

  it('a block\'s own labels win over the context, and English stays the fallback', () => {
    const host = inContext({ showArrows: true, labels: { next: 'Dalej' } });
    expect(host.querySelector('button[aria-label="Dalej"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Poprzedni slajd"]')).not.toBeNull();
    expect(serverDom({ showArrows: true }).querySelector('button[aria-label="Previous slide"]')).not.toBeNull();
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T129, T130 (R5) — the controls'
 * placement per breakpoint and the arrows' look; the grid layout.
 *
 * - A placement per breakpoint renders each placement used once, and the
 *   stylesheet removes it where it does not apply (`--off-sm|md|lg`). One
 *   placement for every breakpoint renders exactly today's markup.
 * - The arrows' variant, shape, size and colour are classes and one custom
 *   property on the root; with none set, nothing is added.
 * - `layout: 'grid'` lays the same items out in columns per breakpoint
 *   (`--pb-cols(-md|-lg)`): a list, no carousel role, no controls, every item
 *   in the server HTML.
 */
describe('CarouselShell — controls per breakpoint, arrow style and the grid (T129, T130)', () => {
  const offClasses = (element: Element | null): string[] =>
    (element?.className.split(/\s+/) ?? []).filter((name) => name.includes('--off-'));

  it('one placement for every breakpoint renders today\'s markup, with no breakpoint classes', () => {
    for (const placement of ['below', 'header', 'overlay'] as const) {
      const host = serverDom({ controlsPlacement: { base: placement }, header: <h2>Latest</h2>, showDots: true });
      for (const group of Array.from(host.querySelectorAll('.cmsc-pb-carousel__controls'))) {
        expect(offClasses(group), placement).toEqual([]);
      }
    }
  });

  it('a placement per breakpoint renders each used placement once, removed by CSS where it does not apply', () => {
    const host = serverDom({ controlsPlacement: { base: 'below', desktop: 'header' }, header: <h2>Latest</h2>, showDots: true });
    const inHeader = host.querySelector('.cmsc-pb-carousel__controls--header');
    const below = host.querySelector('.cmsc-pb-carousel__controls--below');
    const dots = host.querySelector('.cmsc-pb-carousel__controls--dots');
    expect(inHeader?.querySelector('button[aria-label="Next slide"]')).not.toBeNull();
    expect(below?.querySelector('button[aria-label="Next slide"]')).not.toBeNull();
    expect(offClasses(inHeader).sort()).toEqual(['cmsc-pb-carousel__controls--off-md', 'cmsc-pb-carousel__controls--off-sm']);
    expect(offClasses(below)).toEqual(['cmsc-pb-carousel__controls--off-lg']);
    // The header placement's dots row exists only where the header placement applies.
    expect(offClasses(dots).sort()).toEqual(['cmsc-pb-carousel__controls--off-md', 'cmsc-pb-carousel__controls--off-sm']);
    expect(host.querySelector('.cmsc-pb-carousel__viewport button')).toBeNull();

    const tablet = serverDom({ controlsPlacement: { base: 'overlay', tablet: 'below' } });
    expect(offClasses(tablet.querySelector('.cmsc-pb-carousel__controls--overlay'))).toEqual([
      'cmsc-pb-carousel__controls--off-md',
      'cmsc-pb-carousel__controls--off-lg',
    ]);
    expect(offClasses(tablet.querySelector('.cmsc-pb-carousel__controls--below'))).toEqual(['cmsc-pb-carousel__controls--off-sm']);
  });

  it('the editor shows the previewed breakpoint\'s placement only', () => {
    const host = serverDom({
      controlsPlacement: { base: 'below', desktop: 'header' },
      header: <h2>Latest</h2>,
      editorPreview: true,
      previewTier: 'mobile',
      showDots: true,
    });
    expect(host.querySelector('.cmsc-pb-carousel__controls--header')).toBeNull();
    expect(host.querySelector('.cmsc-pb-carousel__controls--below .cmsc-pb-carousel__dots')).not.toBeNull();
  });

  it('the arrows\' variant, shape, size and colour are root classes and a custom property; none by default', () => {
    const styled = region(serverDom({ arrowVariant: 'outline', arrowShape: 'square', arrowSize: 'l', arrowColor: '#1d4ed8' }));
    expect(styled.className).toContain('cmsc-pb-carousel--arrows-outline');
    expect(styled.className).toContain('cmsc-pb-carousel--arrows-square');
    expect(styled.className).toContain('cmsc-pb-carousel--arrows-l');
    expect(styled.getAttribute('style')).toContain('--pb-arrow-color:#1d4ed8');
    expect(region(serverDom({ arrowVariant: 'solid' })).className).toContain('cmsc-pb-carousel--arrows-solid');

    const plain = region(serverDom({}));
    expect(plain.className).not.toContain('--arrows-');
    expect(plain.getAttribute('style')).not.toContain('--pb-arrow-color');
    // Today's values are the defaults: they add nothing either.
    expect(region(serverDom({ arrowVariant: 'default', arrowShape: 'round', arrowSize: 'm' })).className).not.toContain('--arrows-');
  });

  it('the grid lays every item out in columns per breakpoint: a list, no carousel role, no controls', () => {
    const host = serverDom({ layout: 'grid', columns: { base: 1, tablet: 2, desktop: 4 }, gap: 24, showDots: true, autoplay: true }, 5);
    const grid = host.querySelector<HTMLElement>('.cmsc-pb-carousel--grid')!;
    expect(grid).not.toBeNull();
    expect(grid.getAttribute('role')).toBeNull();
    expect(grid.getAttribute('aria-roledescription')).toBeNull();
    const style = grid.getAttribute('style') ?? '';
    expect(style).toContain('--pb-cols:1;--pb-cols-md:2;--pb-cols-lg:4');
    expect(style).toContain('--pb-gap:24px');
    expect(style).not.toContain('--pb-spv');
    const list = host.querySelector('[role="list"]')!;
    expect(list.className).toContain('cmsc-pb-carousel__slides');
    expect(list.querySelectorAll(':scope > [role="listitem"]')).toHaveLength(5);
    expect(host.querySelector('[aria-roledescription="slide"]')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    for (let index = 1; index <= 5; index += 1) expect(host.textContent).toContain(`Slide text ${index}`);
  });

  it('a grid column count is clamped to 1–6 and defaults to 1 / 2 / 3', () => {
    expect(serverDom({ layout: 'grid', columns: 9 }).querySelector('.cmsc-pb-carousel--grid')!.getAttribute('style')).toContain(
      '--pb-cols:6;--pb-cols-md:6;--pb-cols-lg:6',
    );
    expect(serverDom({ layout: 'grid' }).querySelector('.cmsc-pb-carousel--grid')!.getAttribute('style')).toContain(
      '--pb-cols:1;--pb-cols-md:2;--pb-cols-lg:3',
    );
  });

  it('the grid in the editor writes the previewed breakpoint\'s columns and hides no item', () => {
    const host = serverDom({ layout: 'grid', columns: { base: 1, desktop: 3 }, editorPreview: true, previewTier: 'desktop', previewPage: 1 }, 5);
    const grid = host.querySelector('.cmsc-pb-carousel--grid')!;
    expect(grid.getAttribute('style')).toContain('--pb-cols:3');
    expect(host.querySelector('style')).toBeNull();
    expect(host.querySelector('.cmsc-pb-carousel__dots')).toBeNull();
  });
});

describe('CarouselShell — controls alignment and the next arrow\'s own style (T147)', () => {
  const alignClasses = (host: HTMLElement): string[] =>
    (host.querySelector('.cmsc-pb-carousel')?.className.split(/\s+/) ?? []).filter((name) => name.includes('--ctl-'));

  it('centred controls are today\'s: no alignment class, whatever the placement', () => {
    expect(alignClasses(serverDom({ controlsPlacement: 'below', showDots: true }))).toEqual([]);
    expect(alignClasses(serverDom({ controlsPlacement: 'below', controlsAlign: 'center' }))).toEqual([]);
    expect(alignClasses(serverDom({ controlsPlacement: 'below', controlsAlign: { base: 'center', desktop: 'center' } }))).toEqual([]);
  });

  it('an alignment is a root class, and a breakpoint class only where the value changes', () => {
    expect(alignClasses(serverDom({ controlsPlacement: 'below', controlsAlign: 'end' }))).toEqual(['cmsc-pb-carousel--ctl-end']);
    expect(
      alignClasses(serverDom({ controlsPlacement: 'below', controlsAlign: { base: 'center', tablet: 'between', desktop: 'split' } })),
    ).toEqual(['cmsc-pb-carousel--ctl-md-between', 'cmsc-pb-carousel--ctl-lg-split']);
    expect(alignClasses(serverDom({ controlsPlacement: 'below', controlsAlign: { base: 'start', tablet: 'center' } }))).toEqual([
      'cmsc-pb-carousel--ctl-start',
      'cmsc-pb-carousel--ctl-md-center',
    ]);
    // Unknown values are centred.
    expect(alignClasses(serverDom({ controlsPlacement: 'below', controlsAlign: 'middle' as never }))).toEqual([]);
  });

  it('the controls row keeps its markup: previous, dots, next, in the reading order', () => {
    const host = serverDom({ controlsPlacement: 'below', controlsAlign: 'split', showDots: true });
    const row = host.querySelector('.cmsc-pb-carousel__controls--below')!;
    expect(Array.from(row.children).map((child) => child.className)).toEqual([
      'cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--prev',
      'cmsc-pb-carousel__dots',
      'cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--next',
    ]);
  });

  it('the editor previews the chosen breakpoint\'s alignment only; a grid has none', () => {
    const editor = serverDom({
      controlsPlacement: 'below',
      controlsAlign: { base: 'end', desktop: 'split' },
      editorPreview: true,
      previewTier: 'mobile',
    });
    expect(alignClasses(editor)).toEqual(['cmsc-pb-carousel--ctl-end']);
    expect(alignClasses(serverDom({ layout: 'grid', controlsAlign: 'end' }))).toEqual([]);
  });

  it('the next arrow may have its own style; "same" and nothing set add no class', () => {
    const mixed = region(serverDom({ arrowVariant: 'outline', nextArrowVariant: 'solid' }));
    expect(mixed.className).toContain('cmsc-pb-carousel--arrows-outline');
    expect(mixed.className).toContain('cmsc-pb-carousel--next-arrow-solid');
    expect(region(serverDom({ arrowVariant: 'solid', nextArrowVariant: 'default' })).className).toContain(
      'cmsc-pb-carousel--next-arrow-default',
    );
    expect(region(serverDom({ nextArrowVariant: 'same' })).className).not.toContain('--next-arrow-');
    expect(region(serverDom({})).className).not.toContain('--next-arrow-');
    // Both arrows keep one markup: the style is a class on the root, read by the stylesheet.
    const next = mixed.querySelector('.cmsc-pb-carousel__arrow--next')!;
    expect(next.className).toBe('cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--next');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T153 (R8, gap 6): with a track
 * that bleeds past the content edge, the controls below it may line up with
 * the first slide instead of the content edge. Unset (or `container`) is
 * today's alignment; the option is one root class the stylesheet reads, and
 * the markup and reading order of the controls never change.
 */
describe('CarouselShell — controls aligned to the first slide (T153)', () => {
  const toClasses = (host: HTMLElement): string[] =>
    (host.querySelector('.cmsc-pb-carousel')?.className.split(/\s+/) ?? []).filter((name) => name.includes('--ctl-to-'));

  it('unset or the container is today\'s: no class', () => {
    expect(toClasses(serverDom({ controlsPlacement: 'below', bleed: 'end' }))).toEqual([]);
    expect(toClasses(serverDom({ controlsPlacement: 'below', bleed: 'end', controlsAlignTo: 'container' }))).toEqual([]);
    expect(toClasses(serverDom({ controlsPlacement: 'below', controlsAlignTo: 'track' as never }))).toEqual([]);
  });

  it('the first slide adds one root class, published and in the editor; a grid has none', () => {
    expect(toClasses(serverDom({ controlsPlacement: 'below', bleed: 'end', controlsAlignTo: 'slide' }))).toEqual([
      'cmsc-pb-carousel--ctl-to-slide',
    ]);
    expect(
      toClasses(serverDom({ controlsPlacement: 'below', controlsAlignTo: 'slide', editorPreview: true, previewTier: 'desktop' })),
    ).toEqual(['cmsc-pb-carousel--ctl-to-slide']);
    expect(toClasses(serverDom({ layout: 'grid', controlsAlignTo: 'slide' }))).toEqual([]);
  });

  it('the controls row keeps its markup', () => {
    const host = serverDom({ controlsPlacement: 'below', controlsAlignTo: 'slide', controlsAlign: 'end', showDots: true });
    const row = host.querySelector('.cmsc-pb-carousel__controls--below')!;
    expect(Array.from(row.children).map((child) => child.className)).toEqual([
      'cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--prev',
      'cmsc-pb-carousel__dots',
      'cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--next',
    ]);
  });
});

/**
 * T163 (R9, owner request 2026-10-26): the arrows' icon — today's chevron
 * glyphs (`‹` `›`, the default) or a drawn arrow (the icon catalog's
 * `arrowLeft` / `arrowRight`, inline SVG hidden from assistive technology).
 * The button, its accessible name and its classes are the same either way.
 */
describe('CarouselShell — the arrows\' icon: chevron (today) or arrow (T163)', () => {
  const arrowsOf = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>('.cmsc-pb-carousel__arrow'));

  it('unset or chevron: today\'s glyphs in a hidden span, no SVG', () => {
    for (const props of [{}, { arrowIcon: 'chevron' as const }]) {
      const arrows = arrowsOf(serverDom({ controlsPlacement: 'below', ...props }));
      expect(arrows.map((arrow) => arrow.innerHTML)).toEqual(['<span aria-hidden="true">‹</span>', '<span aria-hidden="true">›</span>']);
    }
  });

  it('arrow: a drawn arrow per direction, aria-hidden, the accessible names and classes unchanged', () => {
    const host = serverDom({ controlsPlacement: 'below', arrowIcon: 'arrow' });
    const [previous, next] = arrowsOf(host);
    expect(previous?.getAttribute('aria-label')).toBe('Previous slide');
    expect(next?.getAttribute('aria-label')).toBe('Next slide');
    expect(previous?.className).toBe('cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--prev');
    for (const [arrow, icon] of [[previous, 'arrow-left'], [next, 'arrow-right']] as const) {
      const svg = arrow!.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('class')).toContain(`lucide-${icon}`);
      expect(svg?.getAttribute('class')).toContain('cmsc-pb-carousel__arrow-icon');
      expect(arrow!.textContent).toBe('');
    }
    // The root carries no class for it: the look of the button is the arrow style's.
    expect(region(host).className).not.toContain('arrow-icon');
  });

  it('the track options hand the icon on only when an arrow is chosen', async () => {
    const { carouselShellOptions } = await import('./carousel-parts.js');
    expect(carouselShellOptions({ controls: { arrowIcon: 'arrow' } })).toMatchObject({ arrowIcon: 'arrow' });
    expect(carouselShellOptions({ controls: { arrowIcon: 'chevron' } })).not.toHaveProperty('arrowIcon');
    expect(carouselShellOptions({ controls: { arrowIcon: 'sparkles' as never } })).not.toHaveProperty('arrowIcon');
    expect(carouselShellOptions({})).not.toHaveProperty('arrowIcon');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T171 (R11) — the carousel's ends.
 * Unset, `loop` is today's behaviour: the previous arrow on the first page
 * goes to the last one and the next arrow on the last page goes back to the
 * first; neither arrow is ever disabled. With `loop: false` the arrow at an end
 * carries the native `disabled` attribute (announced as unavailable, out of
 * the tab order), updated as the track scrolls; a focused arrow that becomes
 * disabled hands its focus to the other arrow, so focus is never lost. The
 * disabled arrows look dimmed by default, or a light outline, or a colour.
 */
describe('CarouselShell — the ends: loop and disabled arrows (T171)', () => {
  const page = (host: HTMLElement) => region(host).getAttribute('data-pb-carousel-page');
  const arrow = (host: HTMLElement, which: 'prev' | 'next') =>
    host.querySelector<HTMLButtonElement>(`.cmsc-pb-carousel__arrow--${which}`)!;
  const click = (button: HTMLButtonElement) => act(() => button.click());

  it('unset is today\'s wrap-around: the previous arrow on the first page goes to the last, never disabled', () => {
    const host = clientDom({ effect: 'fade', controlsPlacement: 'below' });
    expect(arrow(host, 'prev').disabled).toBe(false);
    click(arrow(host, 'prev'));
    expect(page(host)).toBe('2');
    expect(arrow(host, 'next').disabled).toBe(false);
    click(arrow(host, 'next'));
    expect(page(host)).toBe('0');
    expect(region(host).className).not.toContain('arrow-off');
  });

  it('loop: true renders exactly what unset renders', () => {
    const html = (props: Partial<CarouselShellProps>) =>
      renderToString(<CarouselShell instanceId="c-1" controlsPlacement="below" {...props}>{slides(3)}</CarouselShell>);
    expect(html({ loop: true })).toBe(html({}));
    expect(html({ loop: true, disabledArrowLook: 'outline-light' })).toBe(html({}));
  });

  it('not looping: the previous arrow is disabled on the server on the first page, the next one is not', () => {
    const host = serverDom({ effect: 'fade', controlsPlacement: 'below', loop: false });
    expect(arrow(host, 'prev').hasAttribute('disabled')).toBe(true);
    expect(arrow(host, 'next').hasAttribute('disabled')).toBe(false);
    // Still named: a disabled control is announced as unavailable, not dropped.
    expect(arrow(host, 'prev').getAttribute('aria-label')).toBe('Previous slide');
  });

  it('not looping: the arrows stop at the ends and are disabled there', () => {
    const host = clientDom({ effect: 'fade', controlsPlacement: 'below', loop: false });
    click(arrow(host, 'next'));
    expect(page(host)).toBe('1');
    expect(arrow(host, 'prev').disabled).toBe(false);
    click(arrow(host, 'next'));
    expect(page(host)).toBe('2');
    expect(arrow(host, 'next').disabled).toBe(true);
    click(arrow(host, 'next'));
    expect(page(host)).toBe('2');
  });

  it('not looping: a focused arrow that becomes disabled hands its focus to the other arrow', () => {
    const host = clientDom({ effect: 'fade', controlsPlacement: 'below', loop: false });
    const next = arrow(host, 'next');
    act(() => next.focus());
    click(next);
    click(next);
    expect(next.disabled).toBe(true);
    expect(document.activeElement).toBe(arrow(host, 'prev'));
  });

  it('not looping: the arrows follow the track as it is scrolled', () => {
    const geometry = { scrollLeft: 0 };
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cmsc-pb-carousel__track') ? 900 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cmsc-pb-carousel__track') ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('cmsc-pb-carousel__track') ? geometry.scrollLeft : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      const left = this.classList.contains('cmsc-pb-carousel__slide') ? index * 300 - geometry.scrollLeft : 0;
      return { left, right: left + 300, width: 300, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const host = clientDom({ controlsPlacement: 'below', loop: false });
    const track = host.querySelector<HTMLElement>('.cmsc-pb-carousel__track')!;
    expect(arrow(host, 'prev').disabled).toBe(true);
    expect(arrow(host, 'next').disabled).toBe(false);
    geometry.scrollLeft = 600;
    act(() => { track.dispatchEvent(new Event('scroll')); });
    expect(arrow(host, 'prev').disabled).toBe(false);
    expect(arrow(host, 'next').disabled).toBe(true);
    geometry.scrollLeft = 300;
    act(() => { track.dispatchEvent(new Event('scroll')); });
    expect(arrow(host, 'prev').disabled).toBe(false);
    expect(arrow(host, 'next').disabled).toBe(false);
  });

  it('not looping: autoplay stops on the last page', () => {
    vi.useFakeTimers();
    const host = clientDom({ effect: 'fade', autoplay: true, intervalMs: 3000, loop: false });
    for (let tick = 0; tick < 6; tick += 1) act(() => { vi.advanceTimersByTime(3000); });
    expect(page(host)).toBe('2');
    expect(host.querySelector('.cmsc-pb-carousel__arrow--next')?.hasAttribute('disabled')).toBe(true);
  });

  it('the disabled arrows\' look: dimmed by default, a light outline, or a colour', () => {
    expect(region(serverDom({ loop: false })).className).not.toContain('arrow-off');
    expect(region(serverDom({ loop: false, disabledArrowLook: 'dim' })).className).not.toContain('arrow-off');
    expect(region(serverDom({ loop: false, disabledArrowLook: 'outline-light' })).className).toContain('cmsc-pb-carousel--arrow-off-light');
    const colored = region(serverDom({ loop: false, disabledArrowLook: 'color', disabledArrowColor: 'var(--cmsb-color-accent, #c2410c)' }));
    expect(colored.className).toContain('cmsc-pb-carousel--arrow-off-color');
    expect(colored.getAttribute('style')).toContain('--pb-arrow-off-color:var(--cmsb-color-accent, #c2410c)');
    // A colour look with no colour falls back to the dimmed one.
    expect(region(serverDom({ loop: false, disabledArrowLook: 'color' })).className).not.toContain('arrow-off');
  });

  it('the track options hand the loop and the disabled look on only when they leave today\'s behaviour', async () => {
    const { carouselShellOptions } = await import('./carousel-parts.js');
    expect(carouselShellOptions({})).not.toHaveProperty('loop');
    expect(carouselShellOptions({ loop: true })).not.toHaveProperty('loop');
    expect(carouselShellOptions({ loop: false })).toMatchObject({ loop: false });
    expect(carouselShellOptions({ loop: false, controls: { disabledArrowLook: 'outline-light' } })).toMatchObject({ disabledArrowLook: 'outline-light' });
    expect(carouselShellOptions({ loop: false, controls: { disabledArrowLook: 'color', disabledArrowColor: '#1d4ed8' } })).toMatchObject({
      disabledArrowLook: 'color',
      disabledArrowColor: '#1d4ed8',
    });
    expect(carouselShellOptions({ loop: false, controls: { disabledArrowLook: 'sparkles' as never } })).not.toHaveProperty('disabledArrowLook');
  });
});
