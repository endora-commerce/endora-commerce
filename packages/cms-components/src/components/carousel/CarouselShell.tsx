'use client';

import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  normalizeResponsive,
  resolveResponsive,
  type BreakpointTier,
  type HideOn,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { setEditorCarouselPage } from '@endora-commerce/page-builder-core/editor/carousel-preview';
import { CMS_ICON_CATALOG } from '../icon-catalog.js';
import { useCmsRenderCarouselLabels, type CmsCarouselLabelText } from '../render-context.js';
import {
  CarouselFilterBar,
  filterButtons,
  itemHasTag,
  type CarouselFilterOptions,
} from './carousel-filter.js';

/**
 * The one carousel shell (`specs/163-page-builder-marketing-pages/` research
 * R-12, FR-019, FR-022): a native scroll-snap track, no dependency.
 *
 * - **Layout is CSS.** Slides per view and the gap are written as
 *   `--pb-spv(-md|-lg)` and `--pb-gap(-md|-lg)` on the root; the stylesheet
 *   sizes each slide `calc((100% - (spv - 1) * gap) / spv)` per breakpoint, so
 *   the server sends the final layout and nothing shifts on hydration. A
 *   fractional value shows the next slide peeking in.
 * - **Script only drives the controls**: arrows, dots and autoplay attach in
 *   effects. The controls hide themselves once everything already fits.
 * - **Fade** stacks the slides in one cell; the inactive ones are hidden from
 *   assistive technology.
 * - **Autoplay** is off unless asked for, never runs under reduced motion,
 *   pauses on hover and focus, and has a pause button.
 * - **Semantics**: a `region` with `aria-roledescription="carousel"`; each
 *   slide a `group` with `aria-roledescription="slide"` named "n of m".
 *
 * The editor canvas keeps its own mode (`editorPreview`): no on-canvas arrows
 * or autoplay, so Puck's drag and click work, and the previewed page chosen
 * from the action bar (`editor-carousel-preview.ts`) shown through CSS.
 *
 * R5 (T129–T131):
 * - **Controls per breakpoint.** `controlsPlacement` may differ per
 *   breakpoint; each placement used is rendered once and the stylesheet removes
 *   it where it does not apply (`__controls--off-sm|md|lg`). One placement for
 *   every breakpoint renders exactly the markup it did before.
 * - **Arrow look**: a variant (outline, solid), a square shape, a size and a
 *   colour, as root classes and `--pb-arrow-color`; today's look is the default.
 * - **Grid**: `layout: 'grid'` lays the same items out in `columns` per
 *   breakpoint (`--pb-cols(-md|-lg)`), as a list with no controls.
 * - **Filter**: an optional bar of tags over the items (`carousel-filter.tsx`);
 *   every item is in the server HTML and only the client hides any.
 *
 * R7 (T143, T147):
 * - **Controls alignment**, per breakpoint, of the rows below the track:
 *   centred (today), start, end, `between` (`space-between`) or `split` (the
 *   arrows at the two ends, the dots centred between). Root classes
 *   `--ctl-<value>`, `--ctl-md-<value>`, `--ctl-lg-<value>`, each written only
 *   where the value changes; the markup and its reading order never change.
 * - **The next arrow's own style** (`nextArrowVariant`), a root class the
 *   stylesheet reads on `__arrow--next`: both arrows keep one markup.
 * - The filter bar's style and alignment pass through to the bar.
 *
 * R8 (T153): **controls aligned to the first slide** (`controlsAlignTo:
 * 'slide'`), one root class `--ctl-to-slide`: the rows below the track take
 * one slide's width, so with a track that bleeds past the content edge the
 * controls end where the first slide does. Unset is the content edge.
 *
 * R11 (T171): **the ends.** Unset, `loop` is today's wrap-around (the previous
 * arrow on the first page goes to the last one, the next arrow on the last page
 * back to the first). With `loop: false` the arrow at an end carries the native
 * `disabled` attribute — on the server for the first page, then following the
 * scroll position — and the arrows stop there; a focused arrow that becomes
 * disabled hands its focus to the other one, autoplay stops on the last page.
 * `disabledArrowLook` styles a disabled arrow: dimmed (default), a light
 * outline or a colour (root classes `--arrow-off-light|color`).
 *
 * R20F (T313, T314): **`dots-start`** puts the dots at the start and both
 * arrows together at the end (a stylesheet order; the markup is unchanged).
 * A chosen alignment also applies to the row inside a split slide, every
 * breakpoint written on the row (`__controls--al-<value>`, `-al-md-`,
 * `-al-lg-`); unset, that row keeps today's start. **`keepArrowsWhenFit`**
 * keeps the controls when every slide fits: both arrows disabled, the dots
 * hidden (their box kept); off, the controls hide as before.
 */

export type CarouselEffect = 'slide' | 'fade';
/** R19B (T253): `slide` puts the controls inside each slide that draws them (`CarouselSlideControls`). */
export type CarouselControlsPlacement = 'header' | 'below' | 'overlay' | 'slide';
export type CarouselBleed = 'none' | 'end' | 'both';
export type CarouselLayout = 'carousel' | 'grid';
export type CarouselArrowVariant = 'default' | 'outline' | 'solid';
export type CarouselArrowShape = 'round' | 'square';
export type CarouselArrowSize = 's' | 'm' | 'l';
export type CarouselArrowIcon = 'chevron' | 'arrow';
export type CarouselControlsAlign = 'center' | 'start' | 'end' | 'between' | 'split' | 'dots-start';
export type CarouselNextArrowVariant = 'same' | CarouselArrowVariant;
export type CarouselControlsAlignTo = 'container' | 'slide';
export type CarouselDisabledArrowLook = 'dim' | 'outline-light' | 'color';

/** T163: a drawn arrow from the icon catalog, hidden from assistive technology (the button carries the name). */
function ArrowIcon({ direction }: { direction: -1 | 1 }): ReactNode {
  const Icon = direction < 0 ? CMS_ICON_CATALOG.arrowLeft : CMS_ICON_CATALOG.arrowRight;
  return <Icon className="cmsc-pb-carousel__arrow-icon" size={16} aria-hidden="true" focusable="false" />;
}

/** The words the shell speaks to assistive technology; English unless the caller passes its own. */
export interface CarouselLabels {
  carousel: string;
  previous: string;
  next: string;
  slide: (n: number, m: number) => string;
  goToSlide: (n: number) => string;
  goToPage: (n: number) => string;
  pause: string;
  play: string;
  /** T131: the filter bar's name, its "All" button and the count announced after a change. */
  filter: string;
  filterAll: string;
  filterCount: (n: number, m: number) => string;
}

/** The context's strings as labels: `{n}`/`{m}` filled in, an absent or blank entry left to the default. */
function labelsFromText(text: CmsCarouselLabelText | undefined): Partial<CarouselLabels> {
  if (!text) return {};
  const out: Partial<CarouselLabels> = {};
  const fill = (template: string, n: number, m?: number): string =>
    template.replaceAll('{n}', String(n)).replaceAll('{m}', m === undefined ? '' : String(m));
  for (const key of ['carousel', 'previous', 'next', 'pause', 'play', 'filter', 'filterAll'] as const) {
    const value = text[key];
    if (value?.trim()) out[key] = value;
  }
  const { slide, goToSlide, goToPage, filterCount } = text;
  if (slide?.trim()) out.slide = (n, m) => fill(slide, n, m);
  if (filterCount?.trim()) out.filterCount = (n, m) => fill(filterCount, n, m);
  if (goToSlide?.trim()) out.goToSlide = (n) => fill(goToSlide, n);
  if (goToPage?.trim()) out.goToPage = (n) => fill(goToPage, n);
  return out;
}

const DEFAULT_LABELS: CarouselLabels = {
  carousel: 'Carousel',
  previous: 'Previous slide',
  next: 'Next slide',
  slide: (n, m) => `${n} of ${m}`,
  goToSlide: (n) => `Go to slide ${n}`,
  goToPage: (n) => `Go to page ${n}`,
  pause: 'Pause autoplay',
  play: 'Start autoplay',
  filter: 'Filter',
  filterAll: 'All',
  filterCount: (n, m) => `${n} of ${m} shown`,
};

export interface CarouselShellProps {
  children: ReactNode;
  /** Slides per view, per breakpoint; fractions give the peek (1–8). */
  slidesPerView?: number | ResponsiveProp<number>;
  /** The gap: px, or a CSS length (a brand spacing variable), per breakpoint. */
  gap?: number | string | ResponsiveProp<number | string>;
  effect?: CarouselEffect;
  autoplay?: boolean;
  intervalMs?: number;
  showArrows?: boolean;
  showDots?: boolean;
  /** Where the arrows sit: over the track's edges (today's look), below it, or in the header; per breakpoint. */
  controlsPlacement?: CarouselControlsPlacement | ResponsiveProp<CarouselControlsPlacement>;
  /** The arrows' look: today's (`default`), an outline or a solid fill; round or square; a size; a CSS colour. */
  arrowVariant?: CarouselArrowVariant;
  arrowShape?: CarouselArrowShape;
  arrowSize?: CarouselArrowSize;
  arrowColor?: string;
  /** T163: the arrows' icon — today's chevron glyphs (default) or the icon catalog's drawn arrows. */
  arrowIcon?: CarouselArrowIcon;
  /** T147: the next arrow's own style; `same` (default) is `arrowVariant`. */
  nextArrowVariant?: CarouselNextArrowVariant;
  /** T147: the alignment of the controls below the track, per breakpoint; centred by default. */
  controlsAlign?: CarouselControlsAlign | ResponsiveProp<CarouselControlsAlign>;
  /**
   * T153: what the controls below the track line up with — the content edge
   * (unset or `container`, today's) or the first slide, which with a track
   * bleeding past the content edge ends before it.
   */
  controlsAlignTo?: CarouselControlsAlignTo;
  /** T171: wrap around at the ends (default, today's), or stop there with the arrow at an end disabled. */
  loop?: boolean;
  /** T171: how a disabled arrow looks when not looping — dimmed (default), a light outline, or `disabledArrowColor`. */
  disabledArrowLook?: CarouselDisabledArrowLook;
  /** T171: a CSS colour from code (a hex or a brand variable) for `disabledArrowLook: 'color'`. */
  disabledArrowColor?: string;
  /** R19B (T241): a solid arrow's glyph, a CSS colour from code; unset is today's white. */
  arrowGlyphColor?: string;
  /**
   * R19B (T242): the breakpoints the arrows / the dots are hidden on (root
   * classes `--arrows-off-sm|md|lg`, `--dots-off-sm|md|lg`); a row of
   * controls left with nothing to show there is removed there too.
   */
  hideArrowsOn?: HideOn;
  hideDotsOn?: HideOn;
  /** R20F (T314): keep the arrows (both disabled, the dots hidden) when every slide fits; off (default) hides the controls. */
  keepArrowsWhenFit?: boolean;
  /** A carousel (today) or a grid of `columns` per breakpoint. */
  layout?: CarouselLayout;
  /** The grid's columns per breakpoint (1–6). */
  columns?: number | ResponsiveProp<number>;
  /** An optional filter bar over the items' tags. */
  filter?: CarouselFilterOptions;
  /** Let the track run past the content edge to the viewport edge. */
  bleed?: CarouselBleed;
  /** Content above the track (a heading, a lead, a button); the arrows join it when placed in the header. */
  header?: ReactNode;
  /** The carousel's accessible name. */
  label?: string;
  labels?: Partial<CarouselLabels>;
  equalHeight?: boolean;
  className?: string;
  /**
   * When true, `children` is a Puck slot. Published, the slot renders through
   * {@link CarouselSlides} (`as`), which wraps each child as a slide; in the
   * editor it is a dropzone whose direct children are the slides.
   */
  slotMode?: boolean;
  /**
   * Editor canvas mode — no on-canvas arrows/autoplay so Puck drag/click work.
   * Use `previewPage` + action-bar / dots to change the visible page.
   */
  editorPreview?: boolean;
  /** Controlled page index when `editorPreview` is true. */
  previewPage?: number;
  /** Carousel id used when dots update the shared editor page store. */
  editorCarouselId?: string;
  /**
   * A stable id of this carousel — the block's id — that its DOM ids are made
   * from (`data-pb-carousel-uid`, the track `id`, every `aria-controls`). It is
   * the same on the server and on hydration whatever is rendered above the
   * block; `useId()` is the fallback, and its value encodes the whole component
   * path from the root, so any difference in the tree above — even one that
   * renders no DOM — turned these attributes into a hydration mismatch (T141).
   */
  instanceId?: string;
  /** Authoritative slide count from Puck data while editing slot carousels. */
  editorSlideCount?: number;
  /** The breakpoint the editor previews; the slides per view are resolved at it. */
  previewTier?: BreakpointTier;
}

// ── Layout as custom properties ──────────────────────────────────────

const MAX_PER_VIEW = 8;
const MAX_COLUMNS = 6;
const DEFAULT_COLUMNS = { base: 1, tablet: 2, desktop: 3 };
const TIERS: readonly BreakpointTier[] = ['mobile', 'tablet', 'desktop'];
const TIER_CLASS: Record<BreakpointTier, string> = { mobile: 'sm', tablet: 'md', desktop: 'lg' };
const PLACEMENTS: readonly CarouselControlsPlacement[] = ['header', 'below', 'overlay', 'slide'];
const ALIGNS: readonly CarouselControlsAlign[] = ['center', 'start', 'end', 'between', 'split', 'dots-start'];

/**
 * T147: the alignment classes — the base tier's unless centred, then a
 * `md`/`lg` class only where the value changes from the tier below. In the
 * editor every tier is the previewed one, so only a base class is written.
 */
function alignClasses(value: CarouselShellProps['controlsAlign'], previewTier: BreakpointTier | null): string[] {
  const valid = (entry: CarouselControlsAlign): CarouselControlsAlign => (ALIGNS.includes(entry) ? entry : 'center');
  const [mobile, tablet, desktop] = tierValues<CarouselControlsAlign>(value, 'center').map(valid) as [
    CarouselControlsAlign,
    CarouselControlsAlign,
    CarouselControlsAlign,
  ];
  if (previewTier !== null) {
    const at = previewTier === 'desktop' ? desktop : previewTier === 'tablet' ? tablet : mobile;
    return at === 'center' ? [] : [`cmsc-pb-carousel--ctl-${at}`];
  }
  const out: string[] = [];
  if (mobile !== 'center') out.push(`cmsc-pb-carousel--ctl-${mobile}`);
  if (tablet !== mobile) out.push(`cmsc-pb-carousel--ctl-md-${tablet}`);
  if (desktop !== tablet) out.push(`cmsc-pb-carousel--ctl-lg-${desktop}`);
  return out;
}

/**
 * R20F (T313): the alignment of the row inside a split slide — nothing while
 * unset (today's start), else every breakpoint's class, since the row's own
 * default (the start) is not the rows below the track' (the centre).
 */
function slideAlignClasses(value: CarouselShellProps['controlsAlign'], previewTier: BreakpointTier | null): string[] {
  if (value === undefined) return [];
  const valid = (entry: CarouselControlsAlign): CarouselControlsAlign => (ALIGNS.includes(entry) ? entry : 'center');
  const [mobile, tablet, desktop] = tierValues<CarouselControlsAlign>(value, 'center').map(valid) as [
    CarouselControlsAlign,
    CarouselControlsAlign,
    CarouselControlsAlign,
  ];
  if (previewTier !== null) {
    const at = previewTier === 'desktop' ? desktop : previewTier === 'tablet' ? tablet : mobile;
    return [`cmsc-pb-carousel__controls--al-${at}`];
  }
  return [`cmsc-pb-carousel__controls--al-${mobile}`, `cmsc-pb-carousel__controls--al-md-${tablet}`, `cmsc-pb-carousel__controls--al-lg-${desktop}`];
}

/**
 * R19B (T242): the breakpoints a "Hide on" choice hides; in the editor (the
 * previewed tier set) every one when the previewed tier is hidden, else none,
 * as the editor shows one placement for every width.
 */
function hiddenTiers(hideOn: HideOn | undefined, previewTier: BreakpointTier | null): BreakpointTier[] {
  if (!hideOn) return [];
  if (previewTier !== null) return hideOn[previewTier] === true ? [...TIERS] : [];
  return TIERS.filter((tier) => hideOn[tier] === true);
}

function clampColumns(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_COLUMNS, Math.max(1, Math.round(n)));
}

/** A colour from code (already resolved: a hex or a brand variable); never a stored free string. */
function colorToCss(value: string): string {
  return value.replace(/[;{}<>]/g, '');
}

/** The placement at each breakpoint, each tier inheriting the one below; anything unknown is `fallback`. */
function placementsPerTier(
  value: CarouselShellProps['controlsPlacement'],
  fallback: CarouselControlsPlacement,
): Record<BreakpointTier, CarouselControlsPlacement> {
  const [mobile, tablet, desktop] = tierValues<CarouselControlsPlacement>(value, fallback).map((placement) =>
    PLACEMENTS.includes(placement) ? placement : fallback,
  ) as [CarouselControlsPlacement, CarouselControlsPlacement, CarouselControlsPlacement];
  return { mobile, tablet, desktop };
}

function clampPerView(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PER_VIEW, Math.max(1, Math.round(n * 100) / 100));
}

function gapToCss(value: number | string): string {
  if (typeof value === 'number') return `${Number.isFinite(value) ? Math.max(0, value) : 16}px`;
  // A CSS length from code (a brand spacing variable); never a stored free string.
  return value.replace(/[;{}<>]/g, '');
}

function tierValues<T>(value: T | ResponsiveProp<T> | undefined, fallback: T): [T, T, T] {
  const responsive = normalizeResponsive<T>(value, fallback);
  const tablet = responsive.tablet ?? responsive.base;
  const desktop = responsive.desktop ?? tablet;
  return [responsive.base, tablet, desktop];
}

/**
 * `--pb-spv`, `--pb-spv-md`, `--pb-spv-lg`, then the gap likewise. In the
 * editor canvas (`tier` set) only the base properties are written, with the
 * previewed tier's value; the stylesheet's media queries fall back to them.
 */
function layoutVars(
  slidesPerView: CarouselShellProps['slidesPerView'],
  gap: CarouselShellProps['gap'],
  fade: boolean,
  tier: BreakpointTier | null,
): Record<string, string> {
  const spv = fade ? ([1, 1, 1] as const) : tierValues<number>(slidesPerView, 1).map(clampPerView);
  const gaps = tierValues<number | string>(gap, 16).map(gapToCss);
  if (tier !== null) {
    const at = tier === 'desktop' ? 2 : tier === 'tablet' ? 1 : 0;
    return { '--pb-spv': String(spv[at]), '--pb-gap': gaps[at]! };
  }
  return {
    '--pb-spv': String(spv[0]),
    '--pb-spv-md': String(spv[1]),
    '--pb-spv-lg': String(spv[2]),
    '--pb-gap': gaps[0]!,
    '--pb-gap-md': gaps[1]!,
    '--pb-gap-lg': gaps[2]!,
  };
}

/** The grid's columns and gap per breakpoint; in the editor, the previewed tier's only. */
function gridVars(
  columns: CarouselShellProps['columns'],
  gap: CarouselShellProps['gap'],
  tier: BreakpointTier | null,
): Record<string, string> {
  const cols = tierValues<number>(columns ?? DEFAULT_COLUMNS, 1).map(clampColumns);
  const gaps = tierValues<number | string>(gap, 16).map(gapToCss);
  if (tier !== null) {
    const at = tier === 'desktop' ? 2 : tier === 'tablet' ? 1 : 0;
    return { '--pb-cols': String(cols[at]), '--pb-gap': gaps[at]! };
  }
  return {
    '--pb-cols': String(cols[0]),
    '--pb-cols-md': String(cols[1]),
    '--pb-cols-lg': String(cols[2]),
    '--pb-gap': gaps[0]!,
    '--pb-gap-md': gaps[1]!,
    '--pb-gap-lg': gaps[2]!,
  };
}

// ── Slides ───────────────────────────────────────────────────────────

interface SlidesContextValue {
  fade: boolean;
  active: number;
  labels: CarouselLabels;
  /** A grid: a list of items, not slide groups. */
  grid: boolean;
  /** The items the filter hides, by position. */
  hidden: ReadonlySet<number>;
}

const NO_HIDDEN: ReadonlySet<number> = new Set();

const SlidesContext = createContext<SlidesContextValue>({
  fade: false,
  active: 0,
  labels: DEFAULT_LABELS,
  grid: false,
  hidden: NO_HIDDEN,
});

/**
 * R19B (T253): the controls a slide draws inside itself, by its position — set
 * by the shell where `controlsPlacement` holds `slide`, `null` everywhere else.
 */
const SlideControlsContext = createContext<((position: number) => ReactNode) | null>(null);

/** R19B (T253): a slide's position among the shown slides, set by `CarouselSlides` for each one. */
const SlidePositionContext = createContext<number | null>(null);

/**
 * R19B (T253): the carousel's arrows and dots, drawn **inside a slide** (a
 * split slide's text column) when the carousel places its controls there;
 * nothing outside a carousel, or with another placement. Only the shown
 * slide's copy is operable, the others `inert`.
 */
export function CarouselSlideControls(): ReactNode {
  const render = useContext(SlideControlsContext);
  const position = useContext(SlidePositionContext);
  if (!render || position === null) return null;
  return render(position);
}

export interface CarouselSlidesProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The slide list: each child wrapped as a slide group named "n of m". A child
 * that is nothing (a block no renderer answers) takes no slide. Puck's
 * published slot renders through it (`<Slot as={CarouselSlides} />`), so the
 * slot's children are slides without the shell knowing the blocks.
 */
export const CarouselSlides = forwardRef<HTMLDivElement, CarouselSlidesProps>(function CarouselSlides(
  { className, style, children },
  ref,
) {
  const { fade, active, labels, grid, hidden } = useContext(SlidesContext);
  const items = Children.toArray(children);
  // The filter's hidden items take no number: the rest are "n of m" among themselves.
  const total = items.filter((_, index) => !hidden.has(index)).length;
  let visible = 0;
  return (
    <div
      ref={ref}
      className={['cmsc-pb-carousel__slides', className ?? ''].filter(Boolean).join(' ')}
      {...(grid ? { role: 'list' } : {})}
      {...(style ? { style } : {})}
    >
      {items.map((child, index) => {
        const key = isValidElement(child) && child.key !== null ? child.key : index;
        const isHidden = hidden.has(index);
        const position = isHidden ? -1 : visible++;
        if (grid) {
          return (
            <div key={key} className="cmsc-pb-carousel__slide" role="listitem" {...(isHidden ? { hidden: true } : {})}>
              {child}
            </div>
          );
        }
        // R19B (T253): the slide's position, for controls drawn inside it (no markup of its own).
        const content = isHidden ? child : <SlidePositionContext.Provider value={position}>{child}</SlidePositionContext.Provider>;
        return (
          <div
            key={key}
            className="cmsc-pb-carousel__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slide(isHidden ? index + 1 : position + 1, isHidden ? items.length : total)}
            {...(isHidden ? { hidden: true } : {})}
            {...(fade && !isHidden && position !== active ? { 'aria-hidden': true } : {})}
            {...(fade && !isHidden && position === active ? { 'data-active': 'true' } : {})}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
});

// ── Geometry (client only) ───────────────────────────────────────────

interface TrackGeometry {
  /** Pixels between two pages. */
  step: number;
  pages: number;
  maxScroll: number;
}

/** Every item wrapper, the filtered-out ones included. */
function allSlideElements(track: HTMLElement): HTMLElement[] {
  const list = track.querySelector('.cmsc-pb-carousel__slides');
  if (!list) return [];
  return Array.from(list.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('cmsc-pb-carousel__slide'),
  );
}

/** The slides shown: the filter's hidden ones take no place in the track. */
function slideElements(track: HTMLElement): HTMLElement[] {
  return allSlideElements(track).filter((el) => !el.hidden);
}

/** A page is as many whole slides as fit; the last page ends at the end of the track. */
function measureTrack(track: HTMLElement): TrackGeometry {
  const slides = slideElements(track);
  const width = track.clientWidth;
  const maxScroll = Math.max(0, track.scrollWidth - width);
  const first = slides[0]?.getBoundingClientRect();
  const second = slides[1]?.getBoundingClientRect();
  const stride = first && second ? second.left - first.left : (first?.width ?? 0);
  const perPage = stride > 0 ? Math.max(1, Math.floor((width + 1) / stride)) : 1;
  const step = stride > 0 ? perPage * stride : width;
  const pages = maxScroll <= 1 || step <= 0 ? 1 : Math.ceil((maxScroll - 1) / step) + 1;
  return { step, pages, maxScroll };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** An id as a CSS string: the editor's preview selector is written into a `<style>`. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`).replace(/[\n\r<>]/g, '')}"`;
}

// ── Shell ────────────────────────────────────────────────────────────

export function CarouselShell({
  children,
  slidesPerView = 1,
  gap = 16,
  effect = 'slide',
  autoplay = false,
  intervalMs = 5000,
  showArrows = true,
  showDots = true,
  controlsPlacement = 'overlay',
  arrowVariant = 'default',
  arrowShape = 'round',
  arrowSize = 'm',
  arrowColor,
  arrowIcon = 'chevron',
  nextArrowVariant = 'same',
  controlsAlign,
  controlsAlignTo,
  loop = true,
  disabledArrowLook = 'dim',
  disabledArrowColor,
  arrowGlyphColor,
  hideArrowsOn,
  hideDotsOn,
  keepArrowsWhenFit = false,
  layout = 'carousel',
  columns,
  filter,
  bleed = 'none',
  header,
  label,
  labels: labelOverrides,
  equalHeight = false,
  className = '',
  slotMode = false,
  editorPreview = false,
  previewPage = 0,
  editorCarouselId,
  instanceId,
  editorSlideCount,
  previewTier,
}: CarouselShellProps): React.ReactElement {
  // English, then the page language's words from the render context (T095), then the block's own.
  const contextLabels = useCmsRenderCarouselLabels();
  const labels = useMemo<CarouselLabels>(
    () => ({ ...DEFAULT_LABELS, ...labelsFromText(contextLabels), ...(labelOverrides ?? {}) }),
    [contextLabels, labelOverrides],
  );
  const grid = layout === 'grid';
  const fade = effect === 'fade' && !grid;
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** T171: the arrow that last had focus, until focus moves elsewhere; a browser may drop focus silently when it is disabled. */
  const focusedArrowRef = useRef<HTMLButtonElement | null>(null);
  const reactId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const carouselUid = editorCarouselId ?? `pb-carousel-${instanceId ? instanceId : reactId}`;
  const trackId = `${carouselUid.replace(/[^A-Za-z0-9_-]/g, '')}-track`;

  // Known on the server for a plain list; a slot's children are counted once mounted.
  const listedCount = slotMode ? 0 : Children.toArray(children).length;
  const [count, setCount] = useState(listedCount);
  const [pages, setPages] = useState(fade ? Math.max(1, listedCount) : 1);
  const [measured, setMeasured] = useState(fade && !slotMode);
  const [active, setActive] = useState(0);
  const [fits, setFits] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const activeRef = useRef(0);
  activeRef.current = active;
  const programmaticRef = useRef(false);
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Filter (T131) ──
  const buttons = useMemo(() => (filter ? filterButtons(filter, labels.filterAll) : []), [filter, labels.filterAll]);
  const showFilter = buttons.length > 1;
  const [filterIndex, setFilterIndex] = useState(0);
  const [filterFocus, setFilterFocus] = useState(0);
  const [hiddenItems, setHiddenItems] = useState<ReadonlySet<number>>(NO_HIDDEN);
  const [announcement, setAnnouncement] = useState('');
  const hiddenKey = Array.from(hiddenItems).join(',');

  // ── Editor preview ──
  const editorPerView = fade
    ? 1
    : Math.max(1, Math.round(resolveResponsive<number>(slidesPerView, previewTier ?? 'desktop', 1)));
  const editorCount =
    editorPreview && typeof editorSlideCount === 'number' && editorSlideCount > 0 ? editorSlideCount : Math.max(1, count);
  const editorPages = Math.max(1, Math.ceil(editorCount / editorPerView));
  const displayPage = editorPreview ? Math.max(0, Math.min(previewPage, editorPages - 1)) : active;

  const editorPreviewStyle = useMemo((): string | null => {
    if (!editorPreview || grid) return null;
    const start = displayPage * editorPerView;
    const end = start + editorPerView;
    const root = `.cmsc-pb-carousel[data-pb-carousel-uid=${cssString(carouselUid)}]`;
    // Only the slides zone's direct children — never nested Slide content.
    const parents = [
      `${root} [data-puck-dropzone$=":slides"]`,
      `${root} .cmsc-pb-content-slider-slot`,
      `${root} .cmsc-pb-carousel__slides`,
    ];
    const selectors: string[] = [];
    for (const parent of parents) {
      if (start > 0) selectors.push(`${parent} > *:nth-child(-n+${start})`);
      selectors.push(`${parent} > *:nth-child(n+${end + 1})`);
    }
    return `${selectors.join(',\n')} { display: none !important; }`;
  }, [editorPreview, grid, displayPage, editorPerView, carouselUid]);

  // ── Measuring ──
  const measure = useCallback((): void => {
    const track = trackRef.current;
    if (!track) return;
    if (editorPreview) {
      const zone =
        track.querySelector('[data-puck-dropzone$=":slides"]') ??
        track.querySelector('.cmsc-pb-content-slider-slot') ??
        track.querySelector('.cmsc-pb-carousel__slides');
      setCount(zone ? Math.max(1, zone.children.length) : Math.max(1, listedCount));
      return;
    }
    const total = slideElements(track).length;
    setCount(total);
    if (fade) {
      setPages(Math.max(1, total));
      setFits(total <= 1);
    } else {
      setFits(track.scrollWidth <= track.clientWidth + 1);
      setPages(measureTrack(track).pages);
    }
    setMeasured(true);
  }, [editorPreview, fade, listedCount]);

  useLayoutEffect(() => {
    measure();
  }, [measure, children, hiddenKey]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(track);
    const list = track.querySelector('.cmsc-pb-carousel__slides, [data-puck-dropzone$=":slides"]');
    const mutations = list && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => measure()) : null;
    if (list && mutations) mutations.observe(list, { childList: true });
    return (): void => {
      observer.disconnect();
      mutations?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    setReducedMotion(prefersReducedMotion());
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReducedMotion(query.matches);
    query.addEventListener?.('change', onChange);
    return (): void => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, pages - 1)));
  }, [pages]);

  useEffect(
    () => (): void => {
      if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
    },
    [],
  );

  // ── Navigation ──
  const goTo = useCallback(
    (index: number): void => {
      if (editorPreview) {
        const page = Math.max(0, Math.min(index, editorPages - 1));
        if (editorCarouselId) setEditorCarouselPage(editorCarouselId, page);
        setActive(page);
        return;
      }
      const total = Math.max(1, pages);
      // T171: today's wrap-around, or a stop at each end.
      const target = loop ? ((index % total) + total) % total : Math.max(0, Math.min(index, total - 1));
      setActive(target);
      if (fade) return;
      const track = trackRef.current;
      if (!track || typeof track.scrollTo !== 'function') return;
      const geometry = measureTrack(track);
      programmaticRef.current = true;
      if (programmaticTimer.current) clearTimeout(programmaticTimer.current);
      programmaticTimer.current = setTimeout(() => {
        programmaticRef.current = false;
      }, 500);
      track.scrollTo({ left: Math.min(geometry.maxScroll, target * geometry.step), behavior: reducedMotion ? 'auto' : 'smooth' });
    },
    [editorPreview, editorPages, editorCarouselId, pages, fade, reducedMotion, loop],
  );

  const step = useCallback((dir: -1 | 1): void => goTo(activeRef.current + dir), [goTo]);

  /** Show only the items carrying the pressed tag ("All": every item); back to the first page. */
  const selectFilter = (index: number): void => {
    setFilterIndex(index);
    if (editorPreview) return;
    const track = trackRef.current;
    if (!track) return;
    const key = buttons[index]?.key ?? null;
    const items = allSlideElements(track);
    const next = new Set<number>();
    if (key !== null) items.forEach((item, position) => {
      if (!itemHasTag(item, key)) next.add(position);
    });
    setHiddenItems(next);
    setAnnouncement(labels.filterCount(items.length - next.size, items.length));
    setActive(0);
    if (!grid && !fade && typeof track.scrollTo === 'function') track.scrollTo({ left: 0, behavior: 'auto' });
  };

  const onScroll = (): void => {
    if (editorPreview || fade || programmaticRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    const geometry = measureTrack(track);
    const page =
      track.scrollLeft >= geometry.maxScroll - 1
        ? geometry.pages - 1
        : Math.round(track.scrollLeft / Math.max(1, geometry.step));
    setActive(Math.max(0, Math.min(page, geometry.pages - 1)));
  };

  // ── Autoplay ──
  const autoplayAvailable = autoplay && !grid && !editorPreview && !reducedMotion && !fits && pages > 1;
  // T171: not looping, autoplay stops on the last page.
  const autoplayRunning = autoplayAvailable && !hovered && !stopped && (loop || active < pages - 1);
  const interval = Math.min(20_000, Math.max(2_000, Number.isFinite(intervalMs) ? intervalMs : 5_000));

  useEffect(() => {
    if (!autoplayRunning) return undefined;
    const id = window.setInterval(() => step(1), interval);
    return (): void => window.clearInterval(id);
  }, [autoplayRunning, interval, step]);

  // T171: not looping, the arrow at an end is disabled (the last page is known once measured);
  // an arrow disabled while it has focus hands the focus to the other arrow of its group.
  // R20F (T314): arrows kept while every slide fits have nowhere to go.
  const keptOff = keepArrowsWhenFit && showArrows && fits && !editorPreview && !grid;
  const prevOff = (!loop && displayPage <= 0) || keptOff;
  const nextOff = (!loop && measured && displayPage >= pages - 1) || keptOff;
  useEffect(() => {
    const arrow = focusedArrowRef.current;
    if (!arrow?.disabled || !rootRef.current?.contains(arrow)) return;
    const focused = typeof document === 'undefined' ? null : document.activeElement;
    if (focused !== arrow && focused !== null && focused !== document.body) return;
    const other = arrow.parentElement?.querySelector<HTMLButtonElement>(
      `.cmsc-pb-carousel__arrow--${arrow.classList.contains('cmsc-pb-carousel__arrow--prev') ? 'next' : 'prev'}`,
    );
    if (other && !other.disabled) other.focus();
  }, [prevOff, nextOff]);

  // ── Render ──
  // The editor shows exactly the previewed page's slides, so its count is whole.
  const vars = (
    grid
      ? gridVars(columns, gap, editorPreview ? (previewTier ?? 'desktop') : null)
      : editorPreview
        ? { ...layoutVars(slidesPerView, gap, fade, previewTier ?? 'desktop'), '--pb-spv': String(editorPerView) }
        : layoutVars(slidesPerView, gap, fade, null)
  ) as Record<string, string>;
  const color = arrowColor?.trim() ? colorToCss(arrowColor.trim()) : '';
  if (color && !grid) vars['--pb-arrow-color'] = color;
  // T171: the disabled arrows' look, only where arrows can be disabled; a colour look needs its colour.
  const offColor = disabledArrowColor?.trim() ? colorToCss(disabledArrowColor.trim()) : '';
  const offLook =
    (loop && !keepArrowsWhenFit) || grid
      ? 'dim'
      : disabledArrowLook === 'outline-light'
        ? 'light'
        : disabledArrowLook === 'color' && offColor
          ? 'color'
          : 'dim';
  if (offLook === 'color') vars['--pb-arrow-off-color'] = offColor;
  // R19B (T241): the glyph of a solid arrow, only when chosen.
  const glyph = arrowGlyphColor?.trim() ? colorToCss(arrowGlyphColor.trim()) : '';
  if (glyph && !grid) vars['--pb-arrow-glyph'] = glyph;

  // The placement at each breakpoint; the editor shows the previewed one's only.
  const perTier = placementsPerTier(controlsPlacement, 'overlay');
  if (editorPreview) {
    // R19B (T253): the editor's slides are a dropzone, not slide groups: controls inside a slide show below there.
    const previewed = perTier[previewTier ?? 'desktop'];
    const at = previewed === 'slide' ? 'below' : previewed;
    perTier.mobile = at;
    perTier.tablet = at;
    perTier.desktop = at;
  }
  const used = PLACEMENTS.filter((placement) => TIERS.some((tier) => perTier[tier] === placement));
  const arrows = showArrows && !editorPreview && !grid;
  const dotCount = editorPreview ? editorPages : measured ? pages : 0;
  const dots = showDots && !grid && (editorPreview ? editorPages > 1 : true);
  // R19B (T242): the arrows and the dots per breakpoint; in the editor, the previewed tier's only.
  const arrowsOff = hiddenTiers(hideArrowsOn, editorPreview ? (previewTier ?? 'desktop') : null);
  const dotsOff = hiddenTiers(hideDotsOn, editorPreview ? (previewTier ?? 'desktop') : null);
  const arrowsAt = (tier: BreakpointTier): boolean => arrows && !arrowsOff.includes(tier);
  const dotsAt = (tier: BreakpointTier): boolean => dots && !dotsOff.includes(tier);
  /**
   * The breakpoint classes that remove a control group where its placement
   * does not apply, or (T242) where it is left with nothing to show.
   */
  const offClasses = (
    applies: (placement: CarouselControlsPlacement) => boolean,
    shows: (tier: BreakpointTier) => boolean = () => true,
  ): string =>
    TIERS.filter((tier) => !applies(perTier[tier]) || !shows(tier))
      .map((tier) => ` cmsc-pb-carousel__controls--off-${TIER_CLASS[tier]}`)
      .join('');

  const carouselClass = [
    'cmsc-pb-carousel',
    grid ? 'cmsc-pb-carousel--grid' : `cmsc-pb-carousel--controls-${perTier.mobile}`,
    fade ? 'cmsc-pb-carousel--fade' : '',
    !grid && (bleed === 'end' || bleed === 'both') ? `cmsc-pb-carousel--bleed-${bleed}` : '',
    !grid && (arrowVariant === 'outline' || arrowVariant === 'solid') ? `cmsc-pb-carousel--arrows-${arrowVariant}` : '',
    !grid && arrowShape === 'square' ? 'cmsc-pb-carousel--arrows-square' : '',
    !grid && (arrowSize === 's' || arrowSize === 'l') ? `cmsc-pb-carousel--arrows-${arrowSize}` : '',
    !grid && (nextArrowVariant === 'default' || nextArrowVariant === 'outline' || nextArrowVariant === 'solid')
      ? `cmsc-pb-carousel--next-arrow-${nextArrowVariant}`
      : '',
    ...(grid ? [] : alignClasses(controlsAlign, editorPreview ? (previewTier ?? 'desktop') : null)),
    !grid && controlsAlignTo === 'slide' ? 'cmsc-pb-carousel--ctl-to-slide' : '',
    offLook !== 'dim' ? `cmsc-pb-carousel--arrow-off-${offLook}` : '',
    // Feature 169 (US1): arrows kept, disabled, because every slide fits get a legible resting look.
    keptOff ? 'cmsc-pb-carousel--arrows-kept' : '',
    ...(grid ? [] : arrowsOff.map((tier) => `cmsc-pb-carousel--arrows-off-${TIER_CLASS[tier]}`)),
    ...(grid ? [] : dotsOff.map((tier) => `cmsc-pb-carousel--dots-off-${TIER_CLASS[tier]}`)),
    editorPreview ? 'cmsc-pb-carousel--editor-preview' : '',
    equalHeight ? 'cmsc-pb-carousel--equal-height' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const arrowButton = (dir: -1 | 1): ReactNode => (
    <button
      type="button"
      className={`cmsc-pb-carousel__arrow cmsc-pb-carousel__arrow--${dir < 0 ? 'prev' : 'next'}`}
      aria-label={dir < 0 ? labels.previous : labels.next}
      aria-controls={trackId}
      {...((dir < 0 ? prevOff : nextOff) ? { disabled: true } : {})}
      onFocus={(event): void => {
        focusedArrowRef.current = event.currentTarget;
      }}
      onBlur={(event): void => {
        if (event.relatedTarget !== null) focusedArrowRef.current = null;
      }}
      onClick={(): void => step(dir)}
    >
      {arrowIcon === 'arrow' ? (
        // T163: the icon catalog's arrow, inline SVG; the button's name is its label.
        <ArrowIcon direction={dir} />
      ) : (
        <span aria-hidden="true">{dir < 0 ? '‹' : '›'}</span>
      )}
    </button>
  );

  const pauseButton = autoplayAvailable ? (
    <button
      type="button"
      className="cmsc-pb-carousel__pause"
      aria-label={stopped ? labels.play : labels.pause}
      onClick={(): void => setStopped((value) => !value)}
    >
      <span aria-hidden="true">{stopped ? '▶' : '❚❚'}</span>
    </button>
  ) : null;

  const dotList = dots ? (
    <div className="cmsc-pb-carousel__dots" {...(keptOff ? { hidden: true } : {})}>
      {Array.from({ length: dotCount }, (_, index) => (
        <button
          key={index}
          type="button"
          aria-label={fade ? labels.goToSlide(index + 1) : labels.goToPage(index + 1)}
          {...(index === displayPage ? { 'aria-current': 'true' as const } : {})}
          aria-controls={trackId}
          className={`cmsc-pb-carousel__dot${index === displayPage ? ' cmsc-pb-carousel__dot--active' : ''}`}
          onClick={(): void => goTo(index)}
        />
      ))}
    </div>
  ) : null;

  const controlsHidden = fits && !editorPreview && !keptOff;
  const headerRow =
    header !== undefined && header !== null && header !== false ? (
      <div className="cmsc-pb-carousel__header-content">{header}</div>
    ) : null;
  const headerShows = (tier: BreakpointTier): boolean => arrowsAt(tier) || pauseButton !== null;
  const headerOff = offClasses((p) => p === 'header', headerShows);
  const headerControls =
    used.includes('header') && (arrows || pauseButton) ? (
      <div className={`cmsc-pb-carousel__controls cmsc-pb-carousel__controls--header${headerOff}`} hidden={controlsHidden}>
        {arrows ? arrowButton(-1) : null}
        {pauseButton}
        {arrows ? arrowButton(1) : null}
      </div>
    ) : null;

  // The dots row under the track, once per placement other than "below" and "slide" (which hold their own).
  const dotRows = used
    .filter((placement) => placement !== 'below' && placement !== 'slide')
    .filter((placement) => dots || (placement === 'overlay' && pauseButton))
    .map((placement) => (
      <div
        key={placement}
        className={`cmsc-pb-carousel__controls cmsc-pb-carousel__controls--dots${offClasses(
          (p) => p === placement,
          (tier) => dotsAt(tier) || (placement === 'overlay' && pauseButton !== null),
        )}`}
        hidden={controlsHidden}
      >
        {dotList}
        {placement === 'overlay' ? pauseButton : null}
      </div>
    ));

  const filterBar = showFilter ? (
    <>
      <CarouselFilterBar
        buttons={buttons}
        active={filterIndex}
        focusIndex={filterFocus}
        label={labels.filter}
        controls={trackId}
        onSelect={selectFilter}
        onFocusIndex={setFilterFocus}
        {...(filter?.style ? { variant: filter.style } : {})}
        {...(filter?.align ? { align: filter.align } : {})}
        {...(filter?.overflow ? { overflow: filter.overflow } : {})}
      />
      <p className="cmsc-sr-only cmsc-pb-carousel__filter-status" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  ) : null;

  const slidesContext: SlidesContextValue = { fade, active: displayPage, labels, grid, hidden: hiddenItems };
  // R19B (T253): the controls a slide draws inside itself where the placement is `slide`; only the shown slide's copy is operable.
  const usesSlide = !grid && used.includes('slide') && (arrows || dots || pauseButton !== null);
  const slideAlign = slideAlignClasses(controlsAlign, editorPreview ? (previewTier ?? 'desktop') : null);
  const slideControls = usesSlide
    ? (position: number): ReactNode => {
        const shown = position === displayPage;
        return (
          <div
            className={`cmsc-pb-carousel__controls cmsc-pb-carousel__controls--slide${offClasses(
              (p) => p === 'slide',
              (tier) => arrowsAt(tier) || dotsAt(tier) || pauseButton !== null,
            )}${slideAlign.map((name) => ` ${name}`).join('')}`}
            hidden={controlsHidden}
            {...(shown ? {} : { inert: true, 'aria-hidden': true })}
          >
            {arrows ? arrowButton(-1) : null}
            {dotList}
            {pauseButton}
            {arrows ? arrowButton(1) : null}
          </div>
        );
      }
    : null;
  const slideList = (
    <SlidesContext.Provider value={slidesContext}>
      <SlideControlsContext.Provider value={slideControls}>
        {slotMode ? children : <CarouselSlides>{children}</CarouselSlides>}
      </SlideControlsContext.Provider>
    </SlidesContext.Provider>
  );

  if (grid) {
    return (
      <div className={carouselClass} data-pb-carousel-uid={carouselUid} style={vars as CSSProperties}>
        {headerRow ? <div className="cmsc-pb-carousel__header">{headerRow}</div> : null}
        {filterBar}
        <div ref={trackRef} id={trackId} className={`cmsc-pb-carousel__track${slotMode ? ' cmsc-pb-carousel__track--slot' : ''}`}>
          {slideList}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={carouselClass}
      role="region"
      aria-roledescription="carousel"
      aria-label={label?.trim() ? label : labels.carousel}
      data-pb-carousel-page={displayPage}
      data-pb-carousel-uid={carouselUid}
      style={vars as CSSProperties}
      onPointerEnter={(): void => setHovered(true)}
      onPointerLeave={(): void => setHovered(false)}
      onFocus={(): void => setHovered(true)}
      onBlur={(event): void => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false);
      }}
    >
      {editorPreviewStyle ? <style>{editorPreviewStyle}</style> : null}
      {headerRow || headerControls ? (
        // T242: a header holding only the controls goes where they are hidden (only once a breakpoint hides the arrows).
        <div className={`cmsc-pb-carousel__header${!headerRow && arrowsOff.length > 0 ? headerOff : ''}`}>
          {headerRow}
          {headerControls}
        </div>
      ) : null}
      {filterBar}
      <div className="cmsc-pb-carousel__viewport cmsc:relative">
        {used.includes('overlay') && arrows ? (
          <div
            className={`cmsc-pb-carousel__controls cmsc-pb-carousel__controls--overlay${offClasses((p) => p === 'overlay')}`}
            hidden={controlsHidden}
          >
            {arrowButton(-1)}
            {arrowButton(1)}
          </div>
        ) : null}
        <div
          ref={trackRef}
          id={trackId}
          className={`cmsc-pb-carousel__track${slotMode ? ' cmsc-pb-carousel__track--slot' : ''}`}
          aria-live={autoplayRunning ? 'off' : 'polite'}
          onScroll={onScroll}
        >
          {slideList}
        </div>
      </div>
      {used.includes('below') && (arrows || dots || pauseButton) ? (
        <div
          className={`cmsc-pb-carousel__controls cmsc-pb-carousel__controls--below${offClasses(
            (p) => p === 'below',
            (tier) => arrowsAt(tier) || dotsAt(tier) || pauseButton !== null,
          )}`}
          hidden={controlsHidden}
        >
          {arrows ? arrowButton(-1) : null}
          {dotList}
          {pauseButton}
          {arrows ? arrowButton(1) : null}
        </div>
      ) : null}
      {usesSlide ? (
        // R19B (T253): under the track where the placement is `slide`, for slides that draw no controls;
        // the stylesheet removes it once a slide of this carousel holds them.
        <div
          className={`cmsc-pb-carousel__controls cmsc-pb-carousel__controls--below cmsc-pb-carousel__controls--slide-fallback${offClasses(
            (p) => p === 'slide',
            (tier) => arrowsAt(tier) || dotsAt(tier) || pauseButton !== null,
          )}`}
          hidden={controlsHidden}
        >
          {arrows ? arrowButton(-1) : null}
          {dotList}
          {pauseButton}
          {arrows ? arrowButton(1) : null}
        </div>
      ) : null}
      {dotRows}
    </div>
  );
}
