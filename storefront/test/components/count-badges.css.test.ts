import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1126 — the shared count badges (`.icon-btn__count` on the header's
 * cart, compare, shopping-list, RFQ and account buttons; `.m-tabbar__badge` on
 * the mobile tab bar) must meet WCAG 2.2 SC 1.4.11 (3:1 non-text contrast)
 * against the header / tab-bar surface in dark mode as well as light.
 *
 * In dark mode the `--brand-700` fill reaches only 2.77:1 on the dark
 * `--surface`, and the badge's 2px ring is `--surface` itself, so it adds no
 * boundary. The fix re-points that ring, through the `dark:` variant (the
 * runtime `.is-dark` scope) only, at the light `--brand-200` tint: a visible
 * edge on the dark surface that still separates from the fill. The fill and
 * the white count stay as they are, so light mode is unchanged.
 *
 * The ratios are computed from the token values in the stylesheet, for every
 * theme block this instance declares, so a theme or token edit that breaks the
 * floor fails here rather than in an audit.
 */

const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Body of the first rule whose selector list is `selector` (whitespace after a comma is free). */
function rule(selector: string): string {
  const list = selector.split(',').map((part) => escape(part.trim())).join(',\\s*');
  const body = new RegExp(`(?:^|[}\\s/])${list}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1];
  if (body === undefined) throw new Error(`no rule for ${selector}`);
  return body;
}

function token(block: string, name: string): string {
  const value = new RegExp(`${escape(name)}:\\s*(#[0-9a-f]{6})\\b`, 'i').exec(block)?.[1];
  if (value === undefined) throw new Error(`no ${name} in block`);
  return value;
}

function channel(hex: string, offset: number): number {
  const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2.2 contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const BADGES = ['.icon-btn__count', '.m-tabbar__badge'] as const;

const themeBlocks = [...css.matchAll(/:root\[data-theme='([a-z0-9-]+)'\]\s*\{([^}]*)\}/g)].map(
  ([, code, body]) => ({ code: code!, body: body! }),
);
const darkSurface = token(rule(':root.is-dark'), '--surface');

describe('count badges keep 3:1 non-text contrast in dark mode (issue #1126)', () => {
  it('keeps the shared light-mode badge rules as they are: surface ring, accent fill, white count', () => {
    for (const badge of BADGES) {
      const body = rule(badge);
      expect(body).toMatch(/border-2 border-surface\b/);
      expect(body).toMatch(/bg-accent\b/);
      expect(body).toMatch(/text-white\b/);
    }
  });

  it('re-points both badges\' ring at the brand-200 tint in dark mode only, with no literal colour', () => {
    for (const badge of BADGES) {
      const body = rule(badge);
      expect(body).toMatch(/\sdark:border-\[color:var\(--brand-200\)\]/);
      expect(body).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it('adds no :root.is-dark component rule, which check:themes would read as the token scope', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.match(/:root\s*\.is-dark\b[^{;]*\{/g)).toEqual([':root.is-dark {']);
  });

  it('declares at least one theme block to measure', () => {
    expect(themeBlocks.map((t) => t.code)).toEqual(expect.arrayContaining(['industria', 'nordic']));
  });

  for (const { code, body } of themeBlocks) {
    it(`${code}: dark ring ≥ 3:1 on the dark surface and against the fill; count text ≥ 4.5:1`, () => {
      const ring = token(body, '--brand-200');
      const fill = token(body, '--brand-700');
      expect(contrast(ring, darkSurface)).toBeGreaterThanOrEqual(3);
      expect(contrast(ring, fill)).toBeGreaterThanOrEqual(3);
      expect(contrast('#ffffff', fill)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${code}: light fill ≥ 3:1 on the light surface`, () => {
      expect(contrast(token(body, '--brand-700'), token(body, '--surface'))).toBeGreaterThanOrEqual(3);
    });
  }
});
