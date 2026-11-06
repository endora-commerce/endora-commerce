import type { BrandFontSource, BrandTypeStyle, CmsBrandTokens } from '@endora-commerce/page-builder-core';
import { isUuidShape } from '@endora-commerce/contracts';

/**
 * Brand tokens as CSS — `specs/163-page-builder-marketing-pages/` data-model §2,
 * research R-3, R-5 and R-6.
 *
 * One pure function, used by the storefront (`<style id="cmsb">` in the
 * document head) and by the admin preview (the same tag inside the Puck
 * iframe), so the two cannot disagree about what a token means.
 *
 * The output is written into a `<style>` element as raw text, so it is built to
 * be safe whatever the stored set holds, not only what the schema admits:
 *
 * - a colour that is not `#rrggbb`, or a number that is not finite, is dropped
 *   rather than written — the stylesheet's own fallback then applies;
 * - a font family name is accepted only from a conservative alphabet (letters,
 *   digits, space, `-`, `_`, `.`) and is always quoted, so it cannot close a
 *   declaration or a rule; a refused name drops the font and its role falls
 *   back to the system stack of its generic family;
 * - an asset URL is written as an escaped CSS string;
 * - a backdrop URL (T154) is written only when it is `https:` or a
 *   site-relative path free of quotes, parentheses, backslashes, `<`, `>` and
 *   whitespace — the contracts' rule, re-checked on whatever is stored — and
 *   then as an escaped CSS string too;
 * - a font-service stylesheet is linked only from a plain `https:` URL;
 * - finally, no `<` survives, so the text can never close its `<style>`.
 */

/** A `<link>` the page needs beside the CSS: a font-service stylesheet, or a preloaded font file. */
export interface BrandFontLink {
  href: string;
  rel: 'stylesheet' | 'preload';
  as?: 'font';
  crossOrigin?: 'anonymous';
}

export interface BrandCss {
  css: string;
  fontLinks: BrandFontLink[];
}

export interface BrandCssOptions {
  /**
   * The URL an asset-library font file is served from. The default is the
   * asset route relative to the current origin; the storefront and the admin
   * pass their API origin.
   */
  assetUrl?: (fileAssetId: string) => string;
  /**
   * T154: how a site-relative media URL (the dark scheme's backdrop given as a
   * URL) is made absolute. The default leaves it as it is; the storefront and
   * the admin rebase it on their API origin, as they do a relative video URL.
   */
  mediaUrl?: (url: string) => string;
}

// The token lists, restated (as `color-value.ts` restates the colour
// fallbacks) so this module reads the stored set by fixed keys and never by
// whatever keys an object happens to carry. `brand-css.test.ts` holds them
// equal to the contracts' lists.
const TYPE_TOKENS = ['display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'small'] as const;
const SPACE_TOKENS = ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl'] as const;
const SCHEMES = ['light', 'muted', 'dark'] as const;
const NEUTRAL_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

/**
 * The system stacks. `sans` is the stack the package's `cmsc:font-sans`
 * utility has always carried, so the built-in set (Inter) changes nothing;
 * `serif` and `mono` are `typography.ts`' stacks.
 */
const SYSTEM_STACKS = {
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

const BUTTON_RADIUS = { square: '0px', rounded: '8px', pill: '999px' } as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FAMILY_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,99}$/u;
const STYLESHEET_URL_RE = /^https:\/\/[^\s"'<>()\\]+$/i;
/** The contracts' `BRAND_MEDIA_URL_RE`, restated; `brand-css.test.ts` holds the two equal. */
const MEDIA_URL_RE = /^(?:https:\/\/[^\s"'<>()\\]+|\/(?!\/)[^\s"'<>()\\]+)$/i;

const DEFAULT_ASSET_URL = (fileAssetId: string): string => `/assets/file/${encodeURIComponent(fileAssetId)}`;

function hex(value: unknown): string | null {
  return typeof value === 'string' && HEX_RE.test(value) ? value.toLowerCase() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `value` as a double-quoted CSS string: every character that could end it is a hex escape. */
function cssString(value: string): string {
  const escaped = value.replace(/[^\p{L}\p{N} ./:?=&%#_~+,;@!$*-]/gu, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
  return `"${escaped}"`;
}

function safeFamily(family: unknown): string | null {
  return typeof family === 'string' && FAMILY_RE.test(family.trim()) ? family.trim() : null;
}

class Declarations {
  private readonly lines: string[] = [];

  set(name: string, value: string | null): void {
    if (value !== null) this.lines.push(`--cmsb-${name}:${value};`);
  }

  toString(): string {
    return this.lines.join('');
  }

  get empty(): boolean {
    return this.lines.length === 0;
  }
}

interface ResolvedFont {
  stack: string;
  faces: string[];
  links: BrandFontLink[];
}

function resolveFont(source: BrandFontSource | undefined, assetUrl: (id: string) => string): ResolvedFont {
  if (!source || source.kind === 'system') {
    const stack = source?.kind === 'system' ? SYSTEM_STACKS[source.stack] ?? SYSTEM_STACKS.sans : SYSTEM_STACKS.sans;
    return { stack, faces: [], links: [] };
  }
  const generic = source.generic === 'serif' ? 'serif' : 'sans-serif';
  const fallback: ResolvedFont = { stack: generic === 'serif' ? SYSTEM_STACKS.serif : SYSTEM_STACKS.sans, faces: [], links: [] };
  const family = safeFamily(source.family);
  if (family === null) return fallback;
  const stack = `"${family}", ${generic}`;

  if (source.kind === 'stylesheet') {
    if (typeof source.url !== 'string' || !STYLESHEET_URL_RE.test(source.url)) return fallback;
    return { stack, faces: [], links: [{ href: source.url, rel: 'stylesheet' }] };
  }

  const faces: string[] = [];
  for (const face of Array.isArray(source.faces) ? source.faces : []) {
    const weight = num(face.weight);
    if (weight === null || typeof face.fileAssetId !== 'string') continue;
    const style = face.style === 'italic' ? 'italic' : 'normal';
    faces.push(
      `@font-face{font-family:"${family}";src:url(${cssString(assetUrl(face.fileAssetId))});` +
        `font-weight:${weight};font-style:${style};font-display:swap;}`,
    );
  }
  if (faces.length === 0) return fallback;
  return { stack, faces, links: [] };
}

/** The face a page needs first: the regular upright one, else the nearest upright weight to 400. */
function regularFace(source: BrandFontSource | undefined): { fileAssetId: string } | null {
  if (source?.kind !== 'asset' || safeFamily(source.family) === null) return null;
  const upright = source.faces.filter((face) => face.style !== 'italic' && typeof face.fileAssetId === 'string');
  if (upright.length === 0) return null;
  return [...upright].sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0]!;
}

function typeDeclarations(target: Declarations, token: string, style: BrandTypeStyle | undefined, tier: 'mobile' | 'desktop'): void {
  if (!style) return;
  const size = num(tier === 'mobile' ? style.mobilePx : style.desktopPx);
  target.set(`t-${token}-size`, size === null ? null : `${size}px`);
  if (tier === 'desktop') return;
  const lineHeight = num(style.lineHeight);
  const weight = num(style.weight);
  const tracking = num(style.trackingEm);
  target.set(`t-${token}-lh`, lineHeight === null ? null : String(lineHeight));
  target.set(`t-${token}-w`, weight === null ? null : String(weight));
  target.set(`t-${token}-ls`, tracking === null ? null : `${tracking}em`);
  target.set(`t-${token}-font`, style.font === 'body' ? 'var(--cmsb-font-body)' : 'var(--cmsb-font-heading)');
}

/** T163: the containers whose headings are rich text — `cms.RichContent` and the composition blocks' rich bodies. */
const RICH_TEXT_SCOPES = ['.cmsc-pb-rich-content', '.cmsc-pb-rich', '.cmsc-pb-hero__body', '.cmsc-pb-feature-list__body'] as const;
const HEADING_TOKENS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * T163: a rich-text heading follows its level's type style — size, line height,
 * weight, tracking — through the variables above (the desktop size rebinds in
 * the one `@media` block). Written only for a level whose style is set, and only
 * the parts that are numbers: with no brand a rich body's headings keep the host
 * page's own heading styles, which no stylesheet fallback could restate.
 */
function richHeadingRule(token: (typeof HEADING_TOKENS)[number], style: BrandTypeStyle | undefined): string | null {
  if (!style) return null;
  const parts: string[] = [];
  if (num(style.mobilePx) !== null) parts.push(`font-size:var(--cmsb-t-${token}-size);`);
  if (num(style.lineHeight) !== null) parts.push(`line-height:var(--cmsb-t-${token}-lh);`);
  if (num(style.weight) !== null) parts.push(`font-weight:var(--cmsb-t-${token}-w);`);
  if (num(style.trackingEm) !== null) parts.push(`letter-spacing:var(--cmsb-t-${token}-ls);`);
  if (parts.length === 0) return null;
  return `${RICH_TEXT_SCOPES.map((scope) => `${scope} ${token}`).join(',')}{${parts.join('')}}`;
}

/** A scheme's decorative backdrop as a CSS `url()`: the library asset, else a safe URL, else nothing. */
function decorativeLayer(
  colors: Partial<CmsBrandTokens['schemes']['dark']> | undefined,
  assetUrl: (id: string) => string,
  mediaUrl: (url: string) => string,
): string | null {
  const assetId = colors?.decorativeAssetId;
  if (typeof assetId === 'string' && isUuidShape(assetId)) return `url(${cssString(assetUrl(assetId))})`;
  const url = colors?.decorativeUrl;
  if (typeof url !== 'string' || url.length > 2048 || !MEDIA_URL_RE.test(url)) return null;
  const absolute = url.startsWith('/') ? mediaUrl(url) : url;
  return `url(${cssString(absolute)})`;
}

function px(value: unknown): string | null {
  const n = num(value);
  return n === null ? null : `${n}px`;
}

/** R20F (T322): a tier factor the schema admits (0.5–2) other than 1, else `null` (nothing written). */
function factor(value: unknown): number | null {
  const n = num(value);
  return n === null || n < 0.5 || n > 2 || n === 1 ? null : n;
}

/** `value` px × `scale`, to two decimals, or `null` for a value that is not a number. */
function scaledPx(value: unknown, scale: number): string | null {
  const n = num(value);
  return n === null ? null : `${Math.round(n * scale * 100) / 100}px`;
}

const BUTTON_HEIGHTS = [
  ['s', 'small'],
  ['m', 'medium'],
  ['l', 'large'],
] as const;

/**
 * R20F (T322): one breakpoint's sizes scaled — every type token's size and
 * every spacing step, from the phone (`mobile`) or the desktop values. The
 * gutters and the container are widths, not scaled. R21H (T352): with
 * `buttons`, the brand's button heights too (one value for every breakpoint).
 */
function scaledTier(tokens: CmsBrandTokens, from: 'mobilePx' | 'desktopPx', scale: number, buttons: boolean): Declarations {
  const out = new Declarations();
  for (const token of TYPE_TOKENS) out.set(`t-${token}-size`, scaledPx(tokens.typeScale?.[token]?.[from], scale));
  for (const token of SPACE_TOKENS) out.set(`space-${token}`, scaledPx(tokens.spacing?.[token]?.[from], scale));
  if (buttons) for (const [key, height] of BUTTON_HEIGHTS) out.set(`btn-h-${key}`, scaledPx(tokens.buttons?.heights?.[height], scale));
  return out;
}

/**
 * R21H (T351): a desktop value growing with the viewport — `scale` × the value
 * at the small-desktop end, the value itself from `untilPx` on, in between the
 * value × viewport / `untilPx` (`clamp()` of a `vw` length, which every
 * browser computes; a length divided by a length would not be).
 */
function fluidPx(value: unknown, scale: number, untilPx: number): string | null {
  const n = num(value);
  if (n === null) return null;
  const min = Math.round(n * scale * 100) / 100;
  const vw = Math.round(((n * 100) / untilPx) * 10000) / 10000;
  return `clamp(${min}px, ${vw}vw, ${n}px)`;
}

function fluidTier(tokens: CmsBrandTokens, scale: number, untilPx: number, buttons: boolean): Declarations {
  const out = new Declarations();
  for (const token of TYPE_TOKENS) out.set(`t-${token}-size`, fluidPx(tokens.typeScale?.[token]?.desktopPx, scale, untilPx));
  for (const token of SPACE_TOKENS) out.set(`space-${token}`, fluidPx(tokens.spacing?.[token]?.desktopPx, scale, untilPx));
  if (buttons) for (const [key, height] of BUTTON_HEIGHTS) out.set(`btn-h-${key}`, fluidPx(tokens.buttons?.heights?.[height], scale, untilPx));
  return out;
}

/**
 * The small-desktop tier's last width: 1279 px, as every block stylesheet's
 * media queries assume. R23 (T432): fixed — the brand no longer moves it.
 */
const SMALL_DESKTOP_UNTIL_PX = 1279;

function widthPx(value: unknown, min: number): number | null {
  const n = num(value);
  return n === null || !Number.isInteger(n) || n < min || n > 3840 ? null : n;
}

/**
 * The `:root` variables, one `[data-cmsb-scheme=…]` rule per colour scheme
 * rebinding `--cmsb-fg`, `-bg`, `-fg-muted`, `-border` and `-link`, the
 * `@font-face` rules of asset-library fonts, one rule per rich-text heading
 * level whose type style is set (T163), and one `@media (min-width: 1024px)`
 * block for the desktop sizes. R20F (T322): with a tier factor other than 1,
 * a tablet block (768–1023 px, before the desktop one) and a small-desktop
 * block (1024–1279 px, after it) rebind the scaled sizes; unset, neither is
 * written and the output is today's. R21H (T351, T352): a fluid block may
 * follow the small-desktop one (`fluidDesktop`) and the button heights may
 * scale (`buttons`). Each writes only when set. R23 (T432): the small-desktop
 * end is fixed at 1279 px and the frame (gutter, container) is not per tier.
 */
export function brandTokensToCss(tokens: CmsBrandTokens, options: BrandCssOptions = {}): BrandCss {
  const assetUrl = options.assetUrl ?? DEFAULT_ASSET_URL;
  const mediaUrl = options.mediaUrl ?? ((url: string): string => url);
  const root = new Declarations();
  const desktop = new Declarations();

  const colors = tokens.colors ?? ({} as CmsBrandTokens['colors']);
  root.set('color-primary', hex(colors.primary));
  root.set('color-primary-hover', hex(colors.primaryHover));
  root.set('color-secondary', hex(colors.secondary));
  root.set('color-secondary-hover', hex(colors.secondaryHover));
  root.set('color-on-primary', hex(colors.onPrimary));
  root.set('color-on-secondary', hex(colors.onSecondary));
  for (const step of NEUTRAL_STEPS) root.set(`n-${step}`, hex(colors.neutral?.[step]));

  const gradient = tokens.accentGradient;
  const from = hex(gradient?.from);
  const to = hex(gradient?.to);
  const angle = num(gradient?.angle);
  root.set('grad', from && to && angle !== null ? `linear-gradient(${angle}deg, ${from}, ${to})` : null);

  // Outside any section the light scheme applies.
  const schemeRules: string[] = [];
  for (const scheme of SCHEMES) {
    const colorsOf = tokens.schemes?.[scheme];
    const block = new Declarations();
    block.set('fg', hex(colorsOf?.text));
    block.set('bg', hex(colorsOf?.background));
    block.set('fg-muted', hex(colorsOf?.textMuted));
    block.set('border', hex(colorsOf?.border));
    block.set('link', hex(colorsOf?.link));
    // The scheme's decorative backdrop (R-8a), painted by a section that asks for it.
    // The library asset wins; a URL (T154) is the fallback, as a video's is.
    block.set('decorative', decorativeLayer(colorsOf, assetUrl, mediaUrl));
    if (scheme === 'light') {
      root.set('fg', hex(colorsOf?.text));
      root.set('bg', hex(colorsOf?.background));
      root.set('fg-muted', hex(colorsOf?.textMuted));
      root.set('border', hex(colorsOf?.border));
      root.set('link', hex(colorsOf?.link));
    }
    if (!block.empty) schemeRules.push(`[data-cmsb-scheme="${scheme}"]{${block.toString()}}`);
  }

  const heading = resolveFont(tokens.fonts?.heading, assetUrl);
  const body = resolveFont(tokens.fonts?.body, assetUrl);
  root.set('font-heading', heading.stack);
  root.set('font-body', body.stack);

  for (const token of TYPE_TOKENS) {
    typeDeclarations(root, token, tokens.typeScale?.[token], 'mobile');
    typeDeclarations(desktop, token, tokens.typeScale?.[token], 'desktop');
  }
  const richHeadings = HEADING_TOKENS.map((token) => richHeadingRule(token, tokens.typeScale?.[token])).filter(
    (rule): rule is string => rule !== null,
  );

  const buttons = tokens.buttons;
  root.set('btn-radius', buttons ? (BUTTON_RADIUS[buttons.radius] ?? null) : null);
  root.set('btn-h-s', px(buttons?.heights?.small));
  root.set('btn-h-m', px(buttons?.heights?.medium));
  root.set('btn-h-l', px(buttons?.heights?.large));
  root.set('btn-weight', num(buttons?.fontWeight) === null ? null : String(buttons!.fontWeight));
  root.set('btn-transform', buttons?.textTransform === 'uppercase' ? 'uppercase' : buttons ? 'none' : null);

  for (const token of SPACE_TOKENS) {
    root.set(`space-${token}`, px(tokens.spacing?.[token]?.mobilePx));
    desktop.set(`space-${token}`, px(tokens.spacing?.[token]?.desktopPx));
  }

  root.set('container', px(tokens.layout?.containerMaxPx));
  root.set('wide', px(tokens.layout?.widePx));
  root.set('gutter', px(tokens.layout?.gutterMobilePx));
  desktop.set('gutter', px(tokens.layout?.gutterDesktopPx));

  const tierScale = tokens.tierScale;
  const scaleButtons = tierScale?.buttons === true;
  const tabletFactor = factor(tierScale?.tablet);
  const smallDesktopFactor = factor(tierScale?.smallDesktop);
  const smallDesktopUntil = SMALL_DESKTOP_UNTIL_PX;
  const tablet = tabletFactor === null ? new Declarations() : scaledTier(tokens, 'mobilePx', tabletFactor, scaleButtons);
  const smallDesktop = smallDesktopFactor === null ? new Declarations() : scaledTier(tokens, 'desktopPx', smallDesktopFactor, scaleButtons);
  // R21H (T351): from the small-desktop end the sizes grow to the desktop ones, reached at `fluidUntil`.
  const fluidUntil = widthPx(tierScale?.fluidUntilPx, 1025) ?? widthPx(tokens.layout?.containerMaxPx, 320);
  const fluid =
    tierScale?.fluidDesktop === true && smallDesktopFactor !== null && smallDesktopFactor < 1 && fluidUntil !== null && fluidUntil > smallDesktopUntil + 1
      ? fluidTier(tokens, smallDesktopFactor, fluidUntil, scaleButtons)
      : null;

  const faces = [...new Set([...heading.faces, ...body.faces])];
  const css = [
    ...faces,
    `:root{${root.toString()}}`,
    ...schemeRules,
    ...richHeadings,
    ...(tablet.empty ? [] : [`@media (min-width: 768px) and (max-width: 1023.98px){:root{${tablet.toString()}}}`]),
    ...(desktop.empty ? [] : [`@media (min-width: 1024px){:root{${desktop.toString()}}}`]),
    ...(smallDesktop.empty ? [] : [`@media (min-width: 1024px) and (max-width: ${smallDesktopUntil}.98px){:root{${smallDesktop.toString()}}}`]),
    ...(fluid && !fluid.empty
      ? [`@media (min-width: ${smallDesktopUntil + 1}px) and (max-width: ${fluidUntil! - 1}.98px){:root{${fluid.toString()}}}`]
      : []),
  ]
    .join('\n')
    // Belt and braces: nothing above can produce `<`, and nothing may.
    .replace(/</g, '\\3c ');

  const fontLinks: BrandFontLink[] = [];
  const seen = new Set<string>();
  for (const link of [...heading.links, ...body.links]) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    fontLinks.push(link);
  }
  const preload = regularFace(tokens.fonts?.body);
  if (preload && body.faces.length > 0) {
    const href = assetUrl(preload.fileAssetId);
    if (!seen.has(href)) fontLinks.push({ href, rel: 'preload', as: 'font', crossOrigin: 'anonymous' });
  }

  return { css, fontLinks };
}

/** The token lists this module reads, for the test that holds them equal to the contracts'. */
export const BRAND_CSS_TOKEN_LISTS = { TYPE_TOKENS, SPACE_TOKENS, SCHEMES } as const;

/** The media-URL rule this module re-checks, for the test that holds it equal to the contracts'. */
export const BRAND_CSS_MEDIA_URL_RE = MEDIA_URL_RE;
