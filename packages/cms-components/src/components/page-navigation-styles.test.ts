import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `specs/169-page-builder-contact-form/` T054, US5, FR-012, FR-013 — the page
 * navigation's stylesheet: one rounded pill track whose active item is filled
 * (the primary colour outside a scheme, the scheme's text colour inside one),
 * an underline look, a list that scrolls sideways on a phone without pulling
 * the page along, a sticky bar below the storefront header, smooth scrolling
 * only for readers who have not asked for reduced motion, a jumped-to target
 * that clears the sticky bar, and a visible keyboard focus.
 *
 * Read from the source stylesheet (whitespace folded) and from the built one,
 * which is what the storefront ships.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fold = (css: string): string => css.replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1');
const source = (): string => fold(readFileSync(resolve(here, '../../styles/cms-components.css'), 'utf8'));
const built = (): string => fold(readFileSync(resolve(here, '../../dist/cms-components.css'), 'utf8'));

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${fold(selector)}{`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  const start = at + fold(selector).length + 1;
  return css.slice(start, css.indexOf('}', start));
}

describe('page navigation stylesheet (T054)', () => {
  it('has its own section, after the tabs and before the accordion', () => {
    const css = readFileSync(resolve(here, '../../styles/cms-components.css'), 'utf8');
    const section = css.indexOf('/* ── Page navigation');
    expect(section).toBeGreaterThan(css.indexOf('/* ── Tabs'));
    expect(section).toBeLessThan(css.indexOf('/* ── Accordion'));
  });

  it('pill: one rounded track, the active item filled with the primary colour', () => {
    const css = source();
    const track = rule(css, '.cmsc-pb-page-nav--pill .cmsc-pb-page-nav__list');
    expect(track).toContain('border-radius:999px');
    expect(track).toContain('background:var(--cmsc-surface-tint,var(--cmsb-n-100,#f1f5f9))');
    const activePill = rule(css, '.cmsc-pb-page-nav--pill .cmsc-pb-page-nav__link--active');
    expect(activePill).toContain('background:var(--cmsb-color-primary,#1261a6)');
    expect(activePill).toContain('color:var(--cmsb-color-on-primary,#fff)');
  });

  it('pill: the other links use the scheme\'s text colour (the muted grey on the tinted track is under 4.5:1)', () => {
    expect(rule(source(), '.cmsc-pb-page-nav--pill .cmsc-pb-page-nav__link')).toContain('color:var(--cmsb-fg,#0f172a)');
  });

  it('pill inside a colour scheme: the active item inverts the scheme', () => {
    const inScheme = rule(source(), '[data-cmsb-scheme] .cmsc-pb-page-nav--pill .cmsc-pb-page-nav__link--active');
    expect(inScheme).toContain('background:var(--cmsb-fg,#0f172a)');
    expect(inScheme).toContain('color:var(--cmsb-bg,#fff)');
  });

  it('underline: a rule under the bar and under the active link', () => {
    const css = source();
    expect(rule(css, '.cmsc-pb-page-nav--underline .cmsc-pb-page-nav__list')).toContain(
      'border-bottom:1px solid var(--cmsb-border,#e2e8f0)',
    );
    const activeLine = rule(css, '.cmsc-pb-page-nav--underline .cmsc-pb-page-nav__link--active');
    expect(activeLine).toContain('border-bottom-color:currentColor');
    expect(activeLine).toContain('color:var(--cmsb-fg,#0f172a)');
  });

  it('the list scrolls sideways inside the block, never the page', () => {
    const list = rule(source(), '.cmsc-pb-page-nav__list');
    expect(list).toContain('overflow-x:auto');
    expect(list).toContain('overscroll-behavior-x:contain');
    expect(list).toContain('flex-wrap:nowrap');
  });

  it('sticky: below the storefront header, on the block\'s own wrapper', () => {
    const css = source();
    const sticky = rule(css, '.cmsc-pb-hide-on:has(> .cmsc-pb-page-nav-box--sticky),.cmsc-pb-page-nav-box--sticky');
    expect(sticky).toContain('position:sticky');
    expect(sticky).toContain('top:var(--cmsb-header-offset,0px)');
    expect(sticky).toContain('z-index:');
  });

  it('smooth scrolling only without a reduced-motion preference', () => {
    expect(source()).toContain(
      '@media (prefers-reduced-motion:no-preference){:root:has(.cmsc-pb-page-nav){scroll-behavior:smooth;}}',
    );
  });

  it('a jumped-to target clears the header and the sticky bar', () => {
    expect(rule(source(), ':root:has(.cmsc-pb-page-nav--sticky) :is(.cmsc-section,[id])')).toContain(
      'scroll-margin-top:calc(var(--cmsb-header-offset,0px) + var(--cmsc-page-nav-h,0px))',
    );
  });

  it('a keyboard focus is visible, as on the tabs', () => {
    const focus = rule(source(), '.cmsc-pb-page-nav__link:focus-visible');
    expect(focus).toContain('outline:2px solid var(--cmsb-color-primary,#1261a6)');
    expect(focus).toContain('outline-offset:2px');
  });

  it('aligns per breakpoint', () => {
    const css = source();
    expect(rule(css, '.cmsc-pb-page-nav--align-center .cmsc-pb-page-nav__list')).toContain('margin-inline:auto');
    expect(css).toContain('.cmsc-pb-page-nav--align-md-end .cmsc-pb-page-nav__list{');
    expect(css).toContain('.cmsc-pb-page-nav--align-lg-center .cmsc-pb-page-nav__list{');
  });

  it('is in the built stylesheet', () => {
    const css = built();
    expect(css).toContain('.cmsc-pb-page-nav__link--active');
    expect(css).toContain('--cmsc-page-nav-h');
  });
});
